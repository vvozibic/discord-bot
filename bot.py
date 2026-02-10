import discord
import asyncio
import re
import config
import easyocr
import io
import os
import json
import time
import tempfile
import secrets
import urllib.parse
import hashlib
import base64
import aiohttp
import hmac
import database

# ============================================================
# Optional OCR acceleration deps (Pillow + numpy)
# If missing, the bot falls back to full-image OCR.
# ============================================================
try:
    from PIL import Image  # type: ignore
    import numpy as np  # type: ignore
    _PIL_OK = True
except Exception:
    Image = None  # type: ignore
    np = None  # type: ignore
    _PIL_OK = False

# ============================================================
# Config
# ============================================================

# ---- X OAuth2 ----
X_CLIENT_ID = getattr(config, "X_CLIENT_ID", os.getenv("X_CLIENT_ID", "")).strip()
X_CLIENT_SECRET = getattr(config, "X_CLIENT_SECRET", os.getenv("X_CLIENT_SECRET", "")).strip()
X_REDIRECT_URI = getattr(config, "X_REDIRECT_URI", os.getenv("X_REDIRECT_URI", "")).strip()
X_SCOPES = getattr(config, "X_SCOPES", os.getenv("X_SCOPES", "users.read tweet.read")).strip()

# ---- Signed link settings ----
LINK_SECRET = getattr(config, "LINK_SECRET", os.getenv("LINK_SECRET", "default-secret-change-me")).strip()
LINK_TTL = 10 * 60  # 10 minutes

# ---- Discord ----
DISCORD_TOKEN = getattr(config, "DISCORD_TOKEN", os.getenv("DISCORD_TOKEN", "")).strip()
# For instant slash commands in a test server, set DISCORD_GUILD_ID (recommended).
DISCORD_GUILD_ID = int(getattr(config, "DISCORD_GUILD_ID", os.getenv("DISCORD_GUILD_ID", "0")) or 0)

# Optional: restrict /verify to one channel (0 = allow everywhere)
VERIFY_CHANNEL_ID = int(getattr(config, "VERIFY_CHANNEL_ID", os.getenv("VERIFY_CHANNEL_ID", "0")) or 0)

# OCR concurrency limiter (important under load)
OCR_CONCURRENCY = int(getattr(config, "OCR_CONCURRENCY", os.getenv("OCR_CONCURRENCY", "4")) or 4)
OCR_SEMAPHORE = asyncio.Semaphore(OCR_CONCURRENCY)

# Downscale very large screenshots for speed (keeps enough detail for numbers)
MAX_IMAGE_SIDE = int(getattr(config, "MAX_IMAGE_SIDE", os.getenv("MAX_IMAGE_SIDE", "1600")) or 1600)

# Enable ROI-based fast OCR (set FAST_OCR=0 to disable)
FAST_OCR = bool(int(getattr(config, "FAST_OCR", os.getenv("FAST_OCR", "1")) or 1))


# Role tier names (fixed, only 3 roles)
TIER_ROLE_NAMES = ["Signal Lite", "Signal Amplifier", "Top Signal"]

# ============================================================
# OCR Setup
# ============================================================
# Note: EasyOCR uses PyTorch under the hood.
# Keep reader global so models are loaded once.
# Note: EasyOCR uses PyTorch under the hood.
# Keep reader global so models are loaded once.
OCR_GPU = bool(int(getattr(config, "OCR_GPU", os.getenv("OCR_GPU", "0")) or 0))
try:
    reader = easyocr.Reader(['en'], gpu=OCR_GPU, verbose=False)
except TypeError:
    # Older easyocr versions might not support verbose=
    reader = easyocr.Reader(['en'], gpu=OCR_GPU)


# ============================================================
# OCR Optimizations: ROI-based fast path
# ============================================================

# Smaller allowlists make recognition faster and more accurate for your use-case.
_ALLOWLIST_NUM = "0123456789.,"
_ALLOWLIST_HANDLE = "@abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_."

# Relative ROIs (x0, y0, x1, y1) for project detection and score reading.
# Using ratios makes it robust across different devices/resolutions.
PROJECT_DETECT_ROIS = [
    (0.00, 0.00, 1.00, 0.25),  # header/top area
    (0.00, 0.20, 1.00, 0.45),  # upper-mid area
]

# Multiple candidate ROIs per project (we try them in order).
SCORE_ROIS = {
    "Cookie": [
        (0.03, 0.32, 0.70, 0.62),
        (0.00, 0.25, 0.85, 0.70),
    ],
    "Kaito": [
        (0.00, 0.25, 0.45, 0.60),  # Total Yaps card/value (often left)
        (0.00, 0.20, 0.60, 0.70),
    ],
    "Xeet": [
        (0.00, 0.45, 0.35, 0.80),  # big number near bottom-left
        (0.00, 0.35, 0.45, 0.80),
    ],
    "Wallchain": [
        (0.25, 0.35, 0.75, 0.80),  # center cards (gauge score)
        (0.15, 0.30, 0.85, 0.85),
    ],
    "Mindoshare": [
        (0.25, 0.20, 0.75, 0.55),
        (0.15, 0.15, 0.85, 0.60),
    ],
}

# Handle usually near the top-left of a profile card/screen.
HANDLE_ROIS = [
    (0.00, 0.00, 0.60, 0.30),
    (0.00, 0.00, 1.00, 0.25),
]

_NUM_RE = re.compile(r"\d[\d,]*\d(?:\.\d+)?|\d(?:\.\d+)?")

def _downscale_image(img):
    """Downscale huge images to reduce OCR cost (keeps aspect ratio)."""
    if not _PIL_OK or MAX_IMAGE_SIDE <= 0:
        return img
    w, h = img.size
    m = max(w, h)
    if m <= MAX_IMAGE_SIDE:
        return img
    scale = MAX_IMAGE_SIDE / float(m)
    new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
    return img.resize(new_size)

def _crop_ratio(img, roi):
    x0, y0, x1, y1 = roi
    w, h = img.size
    left = max(0, int(x0 * w))
    top = max(0, int(y0 * h))
    right = min(w, max(left + 1, int(x1 * w)))
    bottom = min(h, max(top + 1, int(y1 * h)))
    return img.crop((left, top, right, bottom))

def _best_number_from_texts(texts, project):
    """Pick the most likely score from OCR'd strings."""
    nums = []
    for t in texts:
        if not t:
            continue
        for m in _NUM_RE.findall(str(t)):
            s = m.strip()
            if not s:
                continue
            nums.append(s)

    if not nums:
        return None

    # Normalize to float for ranking (keep original string to return)
    parsed = []
    for s in nums:
        try:
            v = float(s.replace(',', ''))
            parsed.append((v, s))
        except ValueError:
            continue

    if not parsed:
        return None

    # Project-specific heuristics
    if project == "Wallchain":
        # Score usually >= 10; avoid tiny % values like 2.91
        parsed = [(v, s) for (v, s) in parsed if v >= 10]
        if not parsed:
            return None
        # Often an integer; pick the largest remaining within a sane range
        parsed.sort(key=lambda x: x[0], reverse=True)
        return parsed[0][1]

    if project == "Xeet":
        # Xeets earned tends to be an integer >= 50
        parsed = [(v, s) for (v, s) in parsed if v >= 50]
        parsed.sort(key=lambda x: x[0], reverse=True)
        return parsed[0][1] if parsed else None

    if project == "Kaito":
        # Total Yaps is often the largest value in the left ROI
        parsed.sort(key=lambda x: x[0], reverse=True)
        return parsed[0][1]

    if project == "Cookie":
        # Total snaps earned is usually a decimal
        parsed.sort(key=lambda x: x[0], reverse=True)
        return parsed[0][1]

    if project == "Mindoshare":
        parsed.sort(key=lambda x: x[0], reverse=True)
        return parsed[0][1]

    # Fallback: largest
    parsed.sort(key=lambda x: x[0], reverse=True)
    return parsed[0][1]

async def _readtext_detail0(img, allowlist):
    """Fast readtext: detail=0 returns only strings (no boxes)."""
    def _run():
        # EasyOCR accepts numpy arrays
        arr = np.array(img) if _PIL_OK else img
        return reader.readtext(arr, detail=0, paragraph=False, allowlist=allowlist, decoder="greedy")
    return await asyncio.to_thread(_run)

async def _fast_detect_project(img):
    """Detect which project screenshot is for using small ROIs."""
    if not _PIL_OK or not FAST_OCR:
        return "Unknown"
    try:
        for roi in PROJECT_DETECT_ROIS:
            crop = _crop_ratio(img, roi)
            texts = await _readtext_detail0(crop, allowlist=_ALLOWLIST_HANDLE + _ALLOWLIST_NUM)
            blob = " ".join(texts).lower()

            if "wallchain" in blob or "quacks" in blob or "quack balance" in blob:
                return "Wallchain"
            if "kaito" in blob or "total yaps" in blob or "earned yaps" in blob:
                return "Kaito"
            if "xeet" in blob or "xeets earned" in blob:
                return "Xeet"
            if "cookie" in blob or "snaps earned" in blob or "total snaps" in blob:
                return "Cookie"
            if "kol score" in blob or "mindoshare" in blob:
                return "Mindoshare"
    except Exception:
        pass
    return "Unknown"

async def _fast_extract_handle(img):
    if not _PIL_OK or not FAST_OCR:
        return None
    try:
        for roi in HANDLE_ROIS:
            crop = _crop_ratio(img, roi)
            texts = await _readtext_detail0(crop, allowlist=_ALLOWLIST_HANDLE)
            for t in texts:
                s = (t or "").strip()
                if s.startswith("@") and len(s) > 3:
                    return s.lstrip("@").strip().strip(".,;:!)]}(")
    except Exception:
        return None
    return None

async def _fast_extract_score(img, project):
    if not _PIL_OK or not FAST_OCR:
        return None
    rois = SCORE_ROIS.get(project) or []
    for roi in rois:
        try:
            crop = _crop_ratio(img, roi)
            texts = await _readtext_detail0(crop, allowlist=_ALLOWLIST_NUM)
            score = _best_number_from_texts(texts, project)
            if score:
                return score
        except Exception:
            continue
    return None

async def detect_project_score_and_handle(image_bytes: bytes, project_hint: str | None = None):
    """
    ROI fast path:
      - decode bytes with Pillow
      - downscale large images
      - detect project (unless hint given)
      - extract score and handle from small crops
    Returns: (pil_img_or_None, project, score_or_None, handle_or_None, used_fast_bool)
    """
    if not _PIL_OK or not FAST_OCR:
        return None, "Unknown", None, None, False

    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        return None, "Unknown", None, None, False

    img = _downscale_image(img)

    proj = (project_hint or "").strip()
    if proj and proj.lower() != "auto":
        proj = proj
    else:
        proj = await _fast_detect_project(img)

    score = None
    if proj != "Unknown":
        score = await _fast_extract_score(img, proj)

    handle = await _fast_extract_handle(img)
    used_fast = (proj != "Unknown" and score is not None)
    return img, proj, score, handle, used_fast


# ============================================================
# Helper: atomic JSON (kept for compatibility)
# ============================================================
STORE_LOCK = asyncio.Lock()
PENDING_FILE = "oauth_pending.json"
PENDING_TTL_SECONDS = 10 * 60  # 10 minutes

def _load_json_sync(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return {}

def _atomic_write_json_sync(path: str, data: dict):
    dir_name = os.path.dirname(os.path.abspath(path))
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, prefix="._tmp_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except:
            pass

async def _cleanup_pending_locked(pending: dict) -> dict:
    now = int(time.time())
    cleaned = {}
    for state, obj in pending.items():
        created_at = int(obj.get("created_at", 0))
        if now - created_at <= PENDING_TTL_SECONDS:
            cleaned[state] = obj
    return cleaned

async def pending_put(state: str, discord_id: str, code_verifier: str):
    async with STORE_LOCK:
        pending = _load_json_sync(PENDING_FILE)
        pending = await _cleanup_pending_locked(pending)
        pending[state] = {
            "discord_id": discord_id,
            "code_verifier": code_verifier,
            "created_at": int(time.time())
        }
        _atomic_write_json_sync(PENDING_FILE, pending)

async def pending_pop(state: str):
    async with STORE_LOCK:
        pending = _load_json_sync(PENDING_FILE)
        pending = await _cleanup_pending_locked(pending)
        obj = pending.pop(state, None)
        _atomic_write_json_sync(PENDING_FILE, pending)
        return obj

# ============================================================
# Link store helpers (DB)
# ============================================================
async def link_get(discord_id: str):
    return await database.get_link(discord_id)

async def link_delete(discord_id: str):
    return await database.delete_link(discord_id)

# ============================================================
# PKCE helpers (for your FastAPI service)
# ============================================================
def _base64url_no_pad(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("utf-8")

def pkce_challenge_s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    return _base64url_no_pad(digest)

async def create_signed_start_link(discord_id: str) -> str:
    """
    Generates a signed link to YOUR OAuth server /x/start endpoint.
    Your FastAPI service verifies (discord_id, ts, sig) with LINK_SECRET.
    """
    ts = int(time.time())
    msg = f"{discord_id}:{ts}".encode("utf-8")
    sig = hmac.new(LINK_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()

    # Base URL = X_REDIRECT_URI minus /x/callback
    base_url = X_REDIRECT_URI.replace("/x/callback", "")
    params = {"discord_id": discord_id, "ts": ts, "sig": sig}
    return f"{base_url}/x/start?" + urllib.parse.urlencode(params)

# ============================================================
# OCR logic (your existing rules)
# ============================================================
def classify_project(results):
    text_blob = " ".join([t[1].lower() for t in results])
    if "wallchain" in text_blob or "quacks" in text_blob or "quack balance" in text_blob:
        return "Wallchain"
    if "kaito" in text_blob or "total yaps" in text_blob or "earned yaps" in text_blob:
        return "Kaito"
    if "xeet" in text_blob or "xeets earned" in text_blob:
        return "Xeet"
    if "cookie" in text_blob or "snaps earned" in text_blob or "total snaps" in text_blob:
        return "Cookie"
    if "kol score" in text_blob or "mindoshare" in text_blob:
        return "Mindoshare"
    return "Unknown"

def extract_mindoshare_score(results):
    kw_bbox = None
    for (bbox, text, prob) in results:
        if "kol score" in text.lower():
            kw_bbox = bbox
            break
    if not kw_bbox:
        return None

    kw_center_x = (kw_bbox[0][0] + kw_bbox[1][0]) / 2
    kw_top_y = kw_bbox[0][1]

    candidates = []
    for (bbox, text, prob) in results:
        if re.match(r'^\d+(\.\d+)?$', text.strip()):
            cand_center_x = (bbox[0][0] + bbox[1][0]) / 2
            cand_bottom_y = bbox[2][1]
            cand_height = bbox[2][1] - bbox[0][1]
            if abs(cand_center_x - kw_center_x) < 100 and cand_bottom_y <= kw_top_y:
                dist = kw_top_y - cand_bottom_y
                candidates.append((cand_height, dist, text))

    candidates.sort(key=lambda x: (-x[0], x[1]))
    return candidates[0][2] if candidates else None

def extract_wallchain_score(results):
    score_bbox = None
    for (bbox, text, prob) in results:
        if text.strip() == "Score":
            score_bbox = bbox
            break
    if not score_bbox:
        return None

    score_center_x = (score_bbox[0][0] + score_bbox[1][0]) / 2
    score_bottom_y = score_bbox[2][1]

    candidates = []
    for (bbox, text, prob) in results:
        clean_text = text.strip()
        if re.match(r'^\d+(\.\d+)?$', clean_text):
            cand_center_x = (bbox[0][0] + bbox[1][0]) / 2
            cand_top_y = bbox[0][1]
            cand_height = bbox[2][1] - bbox[0][1]
            if abs(cand_center_x - score_center_x) < 100 and cand_top_y >= score_bottom_y:
                dist = cand_top_y - score_bottom_y
                candidates.append((cand_height, dist, clean_text))

    candidates.sort(key=lambda x: (-x[0], x[1]))
    return candidates[0][2] if candidates else None

def extract_kaito_score(results):
    total_bbox = None
    yaps_bbox = None
    for (bbox, text, prob) in results:
        t = text.lower().strip()
        if "total" in t and "yaps" in t:
            total_bbox = bbox
            yaps_bbox = bbox
            break
        if t == "total":
            total_bbox = bbox
        if t == "yaps":
            yaps_bbox = bbox

    label_bbox = None
    if total_bbox and yaps_bbox:
        dist_x = abs((total_bbox[0][0] + total_bbox[1][0])/2 - (yaps_bbox[0][0] + yaps_bbox[1][0])/2)
        dist_y = abs(total_bbox[2][1] - yaps_bbox[0][1])
        label_bbox = yaps_bbox if (dist_x < 150 and dist_y < 50) else yaps_bbox
    elif yaps_bbox:
        label_bbox = yaps_bbox
    elif total_bbox:
        label_bbox = total_bbox

    if not label_bbox:
        return None

    label_center_x = (label_bbox[0][0] + label_bbox[1][0]) / 2
    label_bottom_y = label_bbox[2][1]

    candidates = []
    for (bbox, text, prob) in results:
        clean_text = text.strip().replace(',', '')
        if re.match(r'^\d+(\.\d+)?$', clean_text):
            cand_center_x = (bbox[0][0] + bbox[1][0]) / 2
            cand_top_y = bbox[0][1]
            cand_height = bbox[2][1] - bbox[0][1]
            if abs(cand_center_x - label_center_x) < 300 and cand_top_y >= label_bottom_y:
                dist = cand_top_y - label_bottom_y
                candidates.append((cand_height, dist, clean_text))

    candidates.sort(key=lambda x: (-x[0], x[1]))
    return candidates[0][2] if candidates else None

def extract_xeet_score(results):
    label_bbox = None
    for (bbox, text, prob) in results:
        t = text.lower().strip()
        if "xeets earned" in t or ("xeet" in t and "earned" in t):
            label_bbox = bbox
            break
    if not label_bbox:
        for (bbox, text, prob) in results:
            if "earned" in text.lower().strip():
                label_bbox = bbox
                break
    if not label_bbox:
        return None

    label_center_x = (label_bbox[0][0] + label_bbox[1][0]) / 2
    label_top_y = label_bbox[0][1]

    candidates = []
    for (bbox, text, prob) in results:
        clean_text = text.strip().replace(',', '')
        if re.match(r'^\d+(\.\d+)?$', clean_text):
            cand_center_x = (bbox[0][0] + bbox[1][0]) / 2
            cand_bottom_y = bbox[2][1]
            cand_height = bbox[2][1] - bbox[0][1]
            if abs(cand_center_x - label_center_x) < 200 and cand_bottom_y <= label_top_y:
                dist = label_top_y - cand_bottom_y
                candidates.append((cand_height, dist, clean_text))

    candidates.sort(key=lambda x: (-x[0], x[1]))
    return candidates[0][2] if candidates else None

def extract_cookie_score(results):
    label_bbox = None
    for (bbox, text, prob) in results:
        t = text.lower().strip()
        if "total snaps earned" in t or "snaps earned" in t:
            label_bbox = bbox
            break
    if not label_bbox:
        for (bbox, text, prob) in results:
            t = text.lower().strip()
            if "snaps" in t or "earned" in t:
                label_bbox = bbox
                break
    if not label_bbox:
        return None

    label_center_x = (label_bbox[0][0] + label_bbox[1][0]) / 2
    label_center_y = (label_bbox[0][1] + label_bbox[2][1]) / 2

    candidates = []
    for (bbox, text, prob) in results:
        clean_text = text.strip().replace(',', '')
        if re.match(r'^\d+(\.\d+)?$', clean_text):
            cand_center_x = (bbox[0][0] + bbox[1][0]) / 2
            cand_center_y = (bbox[0][1] + bbox[2][1]) / 2
            cand_height = bbox[2][1] - bbox[0][1]
            dist = ((cand_center_x - label_center_x)**2 + (cand_center_y - label_center_y)**2)**0.5
            if dist < 300:
                candidates.append((cand_height, dist, clean_text))

    candidates.sort(key=lambda x: (-x[0], x[1]))
    return candidates[0][2] if candidates else None

def extract_handle(results):
    for (bbox, text, prob) in results:
        t = text.strip()
        if t.startswith('@') and len(t) > 3:
            # trim punctuation that OCR sometimes adds
            return t.lstrip('@').strip().strip('.,;:!)]}(')
    return None

# ============================================================
# Result + Role mapping
# ============================================================
class VerificationResult:
    def __init__(self, detected_score, project="Unknown", handle_match_error=None):
        self.detected_score = detected_score
        self.project = project
        self.handle_match_error = handle_match_error
        self.role_name = None

        if detected_score and not handle_match_error:
            try:
                val = float(str(detected_score).replace(',', '').strip())

                if project == "Kaito":
                    if 50 < val < 200:
                        self.role_name = "Signal Lite"
                    elif 200 <= val < 1000:
                        self.role_name = "Signal Amplifier"
                    elif val >= 1000:
                        self.role_name = "Top Signal"

                elif project == "Wallchain":
                    if 10 < val <= 75:
                        self.role_name = "Signal Lite"
                    elif 76 <= val <= 400:
                        self.role_name = "Signal Amplifier"
                    elif val >= 401:
                        self.role_name = "Top Signal"

                elif project == "Cookie":
                    if 10 <= val <= 200:
                        self.role_name = "Signal Lite"
                    elif 201 <= val <= 400:
                        self.role_name = "Signal Amplifier"
                    elif val >= 401:
                        self.role_name = "Top Signal"

                elif project == "Xeet":
                    if 100 <= val <= 300:
                        self.role_name = "Signal Lite"
                    elif 301 <= val < 1100:
                        self.role_name = "Signal Amplifier"
                    elif val >= 1100:
                        self.role_name = "Top Signal"

                else:
                    # Unknown project: do not assign tier role
                    self.role_name = None
            except ValueError:
                self.role_name = None

# ============================================================
# Discord bot (Slash commands + ephemeral replies)
# ============================================================
intents = discord.Intents.default()
intents.guilds = True
# We intentionally avoid message_content: we do NOT use public chat commands anymore.
intents.message_content = False

client = discord.Client(intents=intents)
tree = discord.app_commands.CommandTree(client)

def _require_verify_channel(interaction: discord.Interaction) -> bool:
    return (VERIFY_CHANNEL_ID == 0) or (interaction.channel_id == VERIFY_CHANNEL_ID)

async def ensure_tier_roles(guild: discord.Guild) -> dict:
    """
    Ensure the 3 tier roles exist. Returns name->Role for roles that exist/created.
    If bot lacks permissions, some entries may be missing (None).
    """
    roles = {}
    for name in TIER_ROLE_NAMES:
        role = discord.utils.get(guild.roles, name=name)
        if role is None:
            try:
                role = await guild.create_role(name=name, reason="Create verifier tier role")
            except discord.Forbidden:
                role = None
        roles[name] = role
    return roles

async def assign_tier_role(member: discord.Member, role_name: str) -> tuple[bool, str]:
    """
    Removes other tier roles and assigns role_name.
    Returns (ok, message).
    """
    if role_name not in TIER_ROLE_NAMES:
        return False, "Invalid tier role name."

    guild = member.guild
    roles_map = await ensure_tier_roles(guild)
    target_role = roles_map.get(role_name)

    if target_role is None:
        return False, "I don't have permission to create/manage roles. Please grant **Manage Roles** and place my bot role above the tier roles."

    # Remove other tier roles (if present)
    to_remove = []
    for n in TIER_ROLE_NAMES:
        if n == role_name:
            continue
        r = roles_map.get(n) or discord.utils.get(guild.roles, name=n)
        if r and r in member.roles:
            to_remove.append(r)

    try:
        if to_remove:
            await member.remove_roles(*to_remove, reason="Update verifier tier role")
        if target_role not in member.roles:
            await member.add_roles(target_role, reason="Verifier tier role assignment")
    except discord.Forbidden:
        return False, "I don't have permission to modify your roles. Check role hierarchy (my role must be above tier roles)."

    return True, "Role assigned."

def build_link_embed(link: str) -> tuple[discord.Embed, discord.ui.View]:
    embed = discord.Embed(
        title="🔗 Link Your X Account",
        description=(
            "To use `/verify`, you must link your X account.\n\n"
            "Click **Connect X Account** below. After you see ✅ Success in your browser, come back and run `/verify`."
        ),
        color=0x1DA1F2
    )
    embed.set_footer(text="⏱️ Link expires in 10 minutes")

    view = discord.ui.View()
    view.add_item(discord.ui.Button(
        label="Connect X Account",
        style=discord.ButtonStyle.link,
        url=link,
        emoji="🔵"
    ))
    return embed, view

def build_result_embed(member: discord.Member, x_link: dict | None, result: VerificationResult) -> discord.Embed:
    if result.handle_match_error:
        desc = f"❌ **Identity Mismatch**\n{result.handle_match_error}\nThis screenshot does not belong to your linked account."
        color = 0xED4245
    elif result.detected_score:
        desc = f"✅ **Verification Successful**\nFound **{result.project}** score!"
        color = 0x57F287
    else:
        desc = f"❌ **Verification Failed**\nCould not detect a **{result.project}** score.\nPlease ensure the image is clear and uncropped."
        color = 0xED4245

    embed = discord.Embed(description=desc, color=color)
    embed.set_author(name=member.display_name, icon_url=member.display_avatar.url)

    if result.detected_score:
        embed.add_field(name="🎯 Score", value=f"`{result.detected_score}`", inline=True)
    if result.role_name:
        embed.add_field(name="🎭 Role", value=f"`{result.role_name}`", inline=True)

    if x_link:
        x_user = x_link.get("x_username")
        x_handle = f"[@{x_user}](https://x.com/{x_user})"
        is_verified = bool(x_link.get("verified")) or (str(x_link.get("verified_type") or "").lower() in {"blue", "business", "government"})
        if is_verified:
            x_handle += " ☑️"
        embed.add_field(name="🔗 X Account", value=x_handle, inline=False)
    else:
        embed.add_field(name="🔗 X Account", value="*Not Linked*", inline=False)

    embed.set_footer(text="Mindo AI Verifier", icon_url=client.user.display_avatar.url if client.user else None)
    return embed

# -----------------------------
# Slash commands (all ephemeral)
# -----------------------------
@tree.command(name="xlink", description="Link your X account for verification")
async def xlink_cmd(interaction: discord.Interaction):
    if not interaction.user:
        return
    link = await create_signed_start_link(str(interaction.user.id))
    embed, view = build_link_embed(link)
    await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

@tree.command(name="xstatus", description="Show your linked X account status")
async def xstatus_cmd(interaction: discord.Interaction):
    obj = await link_get(str(interaction.user.id))
    if not obj:
        await interaction.response.send_message("You have not linked X yet. Use `/xlink`.", ephemeral=True)
        return
    await interaction.response.send_message(
        f"✅ Linked X: @{obj.get('x_username')}\nVerified: {obj.get('verified')} | Type: {obj.get('verified_type')}",
        ephemeral=True
    )

@tree.command(name="xunlink", description="Unlink your X account")
async def xunlink_cmd(interaction: discord.Interaction):
    removed = await link_delete(str(interaction.user.id))
    await interaction.response.send_message("✅ Unlinked." if removed else "You were not linked.", ephemeral=True)

@tree.command(name="verify", description="Upload a screenshot for verification (ephemeral)")
@discord.app_commands.describe(image="Upload a screenshot (PNG/JPG)", project="Which dashboard is in the screenshot (Auto recommended)")
@discord.app_commands.choices(project=[
    discord.app_commands.Choice(name="Auto", value="auto"),
    discord.app_commands.Choice(name="Cookie", value="Cookie"),
    discord.app_commands.Choice(name="Xeet", value="Xeet"),
    discord.app_commands.Choice(name="Kaito", value="Kaito"),
    discord.app_commands.Choice(name="Wallchain", value="Wallchain"),
    discord.app_commands.Choice(name="Mindoshare", value="Mindoshare"),
])
async def verify_cmd(interaction: discord.Interaction, image: discord.Attachment, project: discord.app_commands.Choice[str] | None = None):
    # Must be used in a guild
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        await interaction.response.send_message("This command can only be used in a server.", ephemeral=True)
        return

    if not _require_verify_channel(interaction):
        await interaction.response.send_message("Please use `/verify` in the designated verification channel.", ephemeral=True)
        return

    if not (image.content_type and image.content_type.startswith("image/")):
        await interaction.response.send_message("Please upload a valid image file.", ephemeral=True)
        return

    # Gate: must be linked
    x_link = await link_get(str(interaction.user.id))
    if not x_link:
        link = await create_signed_start_link(str(interaction.user.id))
        embed, view = build_link_embed(link)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
        return

    # Immediately acknowledge (ephemeral)
    await interaction.response.defer(ephemeral=True, thinking=True)

    try:
        image_bytes = await image.read()

        project_hint = (project.value if project else "auto")

        # Concurrency limiter: avoid melting CPU under load.
        # Inside the semaphore we try a fast ROI-based path first; if it can't confidently extract,
        # we fall back to full-image OCR (your existing logic).
        async with OCR_SEMAPHORE:
            pil_img, proj_fast, score_fast, handle_fast, used_fast = await detect_project_score_and_handle(
                image_bytes,
                project_hint=project_hint
            )

            results = None
            project_name = proj_fast

            # If fast path didn't succeed, do full OCR on the downscaled image (if we decoded it),
            # otherwise on raw bytes.
            if (not used_fast) or (project_hint != "auto" and proj_fast == "Unknown"):
                def _full_run():
                    if _PIL_OK and pil_img is not None:
                        return reader.readtext(np.array(pil_img))
                    return reader.readtext(image_bytes)
                results = await asyncio.to_thread(_full_run)
                if project_hint != "auto":
                    project_name = project_hint
                else:
                    project_name = classify_project(results)

            # Decide which score to use
            if used_fast and score_fast is not None and project_name != "Unknown":
                score_val = score_fast
            else:
                # Extract score using your existing rules from full OCR results
                score_val = None
                if results is None:
                    score_val = None
                else:
                    if project_name == "Wallchain":
                        score_val = extract_wallchain_score(results)
                    elif project_name == "Kaito":
                        score_val = extract_kaito_score(results)
                    elif project_name == "Xeet":
                        score_val = extract_xeet_score(results)
                    elif project_name == "Cookie":
                        score_val = extract_cookie_score(results)
                    elif project_name == "Mindoshare":
                        score_val = extract_mindoshare_score(results)
                    else:
                        score_val = extract_mindoshare_score(results) or extract_wallchain_score(results) or extract_kaito_score(results)

            # Handle extraction: prefer fast handle, fallback to full if needed
            img_handle = handle_fast
            if img_handle is None and results is not None:
                img_handle = extract_handle(results)

        project = project_name
        # Handle / identity check
        handle_error = None
        required_handle = (x_link.get("x_username") or "").lower()
        if img_handle and img_handle.lower() != required_handle:
            handle_error = f"Found @{img_handle} in image, but your linked account is @{required_handle}"

        result = VerificationResult(score_val, project, handle_match_error=handle_error)

        # Assign role if applicable and no identity mismatch
        role_note = None
        if result.role_name and not result.handle_match_error:
            ok, msg = await assign_tier_role(interaction.user, result.role_name)
            if not ok:
                role_note = msg

        # Log to DB (always log attempt)
        await database.log_result(
            discord_id=str(interaction.user.id),
            discord_username=str(interaction.user),
            guild_id=str(interaction.guild.id),
            project=project,
            score=str(score_val) if score_val else None,
            role_assigned=result.role_name
        )

        embed = build_result_embed(interaction.user, x_link, result)
        if role_note:
            embed.add_field(name="⚠️ Role assignment", value=role_note, inline=False)

        await interaction.followup.send(embed=embed, ephemeral=True)

    except Exception as e:
        await interaction.followup.send(f"❌ Verification failed: {e}", ephemeral=True)

# -----------------------------
# Events
# -----------------------------
@client.event
async def on_ready():
    print(f"Logged in as {client.user} (ID: {client.user.id})")
    await database.init_db()
    print("Database initialized.")

    # Warm up OCR models (reduces first /verify latency)
    try:
        if _PIL_OK:
            dummy = Image.new('RGB', (320, 240), color=(0, 0, 0))
            await asyncio.to_thread(lambda: reader.readtext(np.array(dummy), detail=0))
    except Exception:
        pass

    # Sync commands
    try:
        if DISCORD_GUILD_ID:
            guild_obj = discord.Object(id=DISCORD_GUILD_ID)
            tree.copy_global_to(guild=guild_obj)
            await tree.sync(guild=guild_obj)
            print(f"Slash commands synced to guild {DISCORD_GUILD_ID}.")
        else:
            await tree.sync()
            print("Slash commands synced globally (may take time to appear).")
    except Exception as e:
        print(f"Failed to sync slash commands: {e}")

# -----------------------------
# Main
# -----------------------------
if __name__ == "__main__":
    if not DISCORD_TOKEN:
        print("Error: DISCORD_TOKEN is not set in config/env.")
    elif not X_CLIENT_ID or not X_REDIRECT_URI:
        print("Error: X_CLIENT_ID / X_REDIRECT_URI missing. Add them to config/env.")
    else:
        client.run(DISCORD_TOKEN)
