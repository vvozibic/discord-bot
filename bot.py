import discord
import asyncio
import re
import config
import easyocr
import torch
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
from discord.ui.media_gallery import MediaGalleryItem
from profile_card import (
    CARD_ATTACHMENT_NAME,
    build_linked_profile_layout,
    ensure_profile_card,
    get_profile_avatar_path,
    remove_profile_assets,
    save_profile_avatar,
)
from x_profile_image import download_profile_image

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
DISCORD_GUILD_ID = int(getattr(config, "DISCORD_GUILD_ID", os.getenv("DISCORD_GUILD_ID", "0")) or 0)

# Optional: restrict /verify to one channel (0 = allow everywhere)
VERIFY_CHANNEL_ID = int(getattr(config, "VERIFY_CHANNEL_ID", os.getenv("VERIFY_CHANNEL_ID", "0")) or 0)

# OCR concurrency limiter (important under load)
DEFAULT_OCR_CONCURRENCY = max(1, min(2, os.cpu_count() or 1))
OCR_CONCURRENCY = int(
    getattr(
        config,
        "OCR_CONCURRENCY",
        os.getenv("OCR_CONCURRENCY", str(DEFAULT_OCR_CONCURRENCY))
    ) or DEFAULT_OCR_CONCURRENCY
)
OCR_SEMAPHORE = asyncio.Semaphore(OCR_CONCURRENCY)
OCR_CANVAS_SIZE = int(getattr(config, "OCR_CANVAS_SIZE", os.getenv("OCR_CANVAS_SIZE", "1920")) or 1920)
OCR_BEAM_WIDTH = int(getattr(config, "OCR_BEAM_WIDTH", os.getenv("OCR_BEAM_WIDTH", "5")) or 5)
OCR_BATCH_SIZE = int(getattr(config, "OCR_BATCH_SIZE", os.getenv("OCR_BATCH_SIZE", "1")) or 1)
OCR_WORKERS = int(getattr(config, "OCR_WORKERS", os.getenv("OCR_WORKERS", "0")) or 0)

# Role tier names (fixed, only 3 roles)
TIER_ROLE_NAMES = ["Signal Lite", "Signal Amplifier", "Top Signal"]

# Role mentions for /super text
SMALLER_IMPACT_ROLE_MENTION = "<@&1469347228777713918>"
TOP_IMPACT_ROLE_MENTION = "<@&1473697234494292021>"
MID_IMPACT_ROLE_TEXT = "@Signal Booster"

# ============================================================
# OCR Setup
# ============================================================
reader = easyocr.Reader(['en'], gpu=torch.cuda.is_available(), verbose=False)

def run_ocr(image_bytes: bytes):
    return reader.readtext(
        image_bytes,
        decoder="greedy",
        beamWidth=OCR_BEAM_WIDTH,
        batch_size=OCR_BATCH_SIZE,
        workers=OCR_WORKERS,
        paragraph=False,
        detail=1,
        canvas_size=OCR_CANVAS_SIZE,
    )

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
        except Exception:
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


async def _ensure_cached_linked_profile_avatar(discord_id: str, profile_image_url: str | None) -> str | None:
    existing_avatar = get_profile_avatar_path(discord_id)
    if existing_avatar:
        return existing_avatar

    avatar_bytes, content_type = await download_profile_image(profile_image_url)
    return save_profile_avatar(discord_id, avatar_bytes, content_type)

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

    base_url = X_REDIRECT_URI.replace("/x/callback", "")
    params = {"discord_id": discord_id, "ts": ts, "sig": sig}
    return f"{base_url}/x/start?" + urllib.parse.urlencode(params)

# ============================================================
# OCR logic
# ============================================================
def classify_project(results):
    text_blob = " ".join([t[1].lower() for t in results])
    if "wallchain" in text_blob or "quacks" in text_blob or "quack balance" in text_blob:
        return "Wallchain"
    if "kaito" in text_blob or "total yaps" in text_blob or "earned yaps" in text_blob:
        return "Kaito"
    if "xeets earned" in text_blob or ("xeet" in text_blob and "earned" in text_blob):
        return "Xeet"
    if "cookie" in text_blob or "snaps earned" in text_blob or "total snaps" in text_blob:
        return "Cookie"
    if "kol score" in text_blob or "mindoshare" in text_blob:
        return "Mindoshare"
    return "Unknown"

def _extract_numeric_token(text: str, allow_decimal: bool = True):
    clean = text.strip().replace(",", "")
    if not clean:
        return None
    match = re.search(r"\d+(?:\.\d+)?", clean)
    if not match:
        return None
    token = match.group(0)
    if (not allow_decimal) and ("." in token):
        return None
    return token

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
    quack_bbox = None
    balance_bbox = None
    quack_balance_bbox = None
    score_bbox = None
    top_bbox = None
    for (bbox, text, prob) in results:
        t = text.lower().strip()
        if "quack balance" in t:
            quack_balance_bbox = bbox
        elif "quack" in t and quack_bbox is None:
            quack_bbox = bbox
        elif "balance" in t and balance_bbox is None:
            balance_bbox = bbox
        if t == "score":
            score_bbox = bbox
        if ("top" in t and "%" in t) or t == "top":
            top_bbox = bbox

    if quack_balance_bbox is None and quack_bbox and balance_bbox:
        quack_center_y = (quack_bbox[0][1] + quack_bbox[2][1]) / 2
        balance_center_y = (balance_bbox[0][1] + balance_bbox[2][1]) / 2
        if abs(quack_center_y - balance_center_y) < 50:
            quack_balance_bbox = [
                [min(quack_bbox[0][0], balance_bbox[0][0]), min(quack_bbox[0][1], balance_bbox[0][1])],
                [max(quack_bbox[1][0], balance_bbox[1][0]), min(quack_bbox[1][1], balance_bbox[1][1])],
                [max(quack_bbox[2][0], balance_bbox[2][0]), max(quack_bbox[2][1], balance_bbox[2][1])],
                [min(quack_bbox[3][0], balance_bbox[3][0]), max(quack_bbox[3][1], balance_bbox[3][1])],
            ]

    if quack_balance_bbox:
        label_left_x = min(p[0] for p in quack_balance_bbox)
        label_right_x = max(p[0] for p in quack_balance_bbox)
        label_center_x = (label_left_x + label_right_x) / 2
        label_bottom_y = max(quack_balance_bbox[2][1], quack_balance_bbox[3][1])
        balance_candidates = []
        for (bbox, text, prob) in results:
            if "%" in text:
                continue
            clean_text = _extract_numeric_token(text, allow_decimal=True)
            if not clean_text:
                continue
            try:
                value = float(clean_text)
            except ValueError:
                continue
            if value <= 0:
                continue

            cand_center_x = (bbox[0][0] + bbox[1][0]) / 2
            cand_top_y = min(bbox[0][1], bbox[1][1])
            cand_height = max(bbox[2][1], bbox[3][1]) - min(bbox[0][1], bbox[1][1])

            if (
                label_left_x - 80 <= cand_center_x <= label_right_x + 420
                and label_bottom_y - 15 <= cand_top_y <= label_bottom_y + 260
            ):
                vertical_dist = abs(cand_top_y - (label_bottom_y + 35))
                horizontal_dist = abs(cand_center_x - (label_center_x - 20))
                decimal_bonus = 1 if "." in clean_text else 0
                balance_candidates.append((decimal_bonus, cand_height, -(vertical_dist + horizontal_dist), clean_text))

        balance_candidates.sort(key=lambda x: (-x[0], -x[1], -x[2]))
        if balance_candidates:
            return balance_candidates[0][3]

    if top_bbox:
        top_center_x = (top_bbox[0][0] + top_bbox[1][0]) / 2
        top_top_y = min(top_bbox[0][1], top_bbox[1][1])
        top_candidates = []
        for (bbox, text, prob) in results:
            clean_text = _extract_numeric_token(text, allow_decimal=False)
            if not clean_text:
                continue
            try:
                value = int(clean_text)
            except ValueError:
                continue
            if value <= 0:
                continue
            cand_center_x = (bbox[0][0] + bbox[1][0]) / 2
            cand_bottom_y = max(bbox[2][1], bbox[3][1])
            cand_height = max(bbox[2][1], bbox[3][1]) - min(bbox[0][1], bbox[1][1])
            if abs(cand_center_x - top_center_x) < 180 and cand_bottom_y <= top_top_y:
                dist = top_top_y - cand_bottom_y
                if dist <= 180:
                    top_candidates.append((cand_height, dist, clean_text))

        top_candidates.sort(key=lambda x: (-x[0], x[1]))
        if top_candidates:
            return top_candidates[0][2]

    if not score_bbox:
        return None

    score_left_x = min(p[0] for p in score_bbox)
    score_right_x = max(p[0] for p in score_bbox)
    score_bottom_y = max(score_bbox[2][1], score_bbox[3][1])
    search_left_x = score_left_x - 40
    search_right_x = score_right_x + 340
    search_top_y = score_bottom_y + 10

    candidates = []
    for (bbox, text, prob) in results:
        clean_text = _extract_numeric_token(text, allow_decimal=False)
        if not clean_text:
            continue
        try:
            value = int(clean_text)
        except ValueError:
            continue
        if value <= 0:
            continue

        cand_center_x = (bbox[0][0] + bbox[1][0]) / 2
        cand_top_y = min(bbox[0][1], bbox[1][1])
        cand_height = max(bbox[2][1], bbox[3][1]) - min(bbox[0][1], bbox[1][1])

        if search_left_x <= cand_center_x <= search_right_x and cand_top_y >= search_top_y:
            dist = cand_top_y - search_top_y
            if dist <= 300:
                digit_bonus = 1 if len(clean_text) >= 2 else 0
                candidates.append((digit_bonus, cand_height, dist, clean_text))

    candidates.sort(key=lambda x: (-x[0], -x[1], x[2]))
    return candidates[0][3] if candidates else None

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
        dist_x = abs((total_bbox[0][0] + total_bbox[1][0]) / 2 - (yaps_bbox[0][0] + yaps_bbox[1][0]) / 2)
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
        xeet_bbox = None
        earned_bbox = None
        for (bbox, text, prob) in results:
            t = text.lower().strip()
            if xeet_bbox is None and "xeet" in t:
                xeet_bbox = bbox
            if earned_bbox is None and "earned" in t:
                earned_bbox = bbox
        if xeet_bbox and earned_bbox:
            xeet_center_y = (xeet_bbox[0][1] + xeet_bbox[2][1]) / 2
            earned_center_y = (earned_bbox[0][1] + earned_bbox[2][1]) / 2
            if abs(xeet_center_y - earned_center_y) < 60:
                label_bbox = [
                    [min(xeet_bbox[0][0], earned_bbox[0][0]), min(xeet_bbox[0][1], earned_bbox[0][1])],
                    [max(xeet_bbox[1][0], earned_bbox[1][0]), min(xeet_bbox[1][1], earned_bbox[1][1])],
                    [max(xeet_bbox[2][0], earned_bbox[2][0]), max(xeet_bbox[2][1], earned_bbox[2][1])],
                    [min(xeet_bbox[3][0], earned_bbox[3][0]), max(xeet_bbox[3][1], earned_bbox[3][1])],
                ]

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
    total_bbox = None
    snaps_bbox = None
    earned_bbox = None

    for (bbox, text, prob) in results:
        t = text.lower().strip()
        if "total snaps earned" in t:
            label_bbox = bbox
            break
        if total_bbox is None and t == "total":
            total_bbox = bbox
        if snaps_bbox is None and "snaps" in t:
            snaps_bbox = bbox
        if earned_bbox is None and "earned" in t:
            earned_bbox = bbox

    if label_bbox is None and total_bbox and snaps_bbox and earned_bbox:
        y_total = (total_bbox[0][1] + total_bbox[2][1]) / 2
        y_snaps = (snaps_bbox[0][1] + snaps_bbox[2][1]) / 2
        y_earned = (earned_bbox[0][1] + earned_bbox[2][1]) / 2
        if max(abs(y_total - y_snaps), abs(y_snaps - y_earned), abs(y_total - y_earned)) < 70:
            label_bbox = [
                [min(total_bbox[0][0], snaps_bbox[0][0], earned_bbox[0][0]), min(total_bbox[0][1], snaps_bbox[0][1], earned_bbox[0][1])],
                [max(total_bbox[1][0], snaps_bbox[1][0], earned_bbox[1][0]), min(total_bbox[1][1], snaps_bbox[1][1], earned_bbox[1][1])],
                [max(total_bbox[2][0], snaps_bbox[2][0], earned_bbox[2][0]), max(total_bbox[2][1], snaps_bbox[2][1], earned_bbox[2][1])],
                [min(total_bbox[3][0], snaps_bbox[3][0], earned_bbox[3][0]), max(total_bbox[3][1], snaps_bbox[3][1], earned_bbox[3][1])],
            ]

    if not label_bbox:
        return None

    label_left_x = min(p[0] for p in label_bbox)
    label_right_x = max(p[0] for p in label_bbox)
    label_center_x = (label_left_x + label_right_x) / 2
    label_bottom_y = max(label_bbox[2][1], label_bbox[3][1])

    candidates = []
    for (bbox, text, prob) in results:
        if "%" in text:
            continue
        clean_text = _extract_numeric_token(text, allow_decimal=True)
        if not clean_text:
            continue
        try:
            value = float(clean_text)
        except ValueError:
            continue
        if value <= 0:
            continue

        cand_center_x = (bbox[0][0] + bbox[1][0]) / 2
        cand_top_y = min(bbox[0][1], bbox[1][1])
        cand_height = max(bbox[2][1], bbox[3][1]) - min(bbox[0][1], bbox[1][1])

        if (
            label_left_x - 120 <= cand_center_x <= label_right_x + 260
            and label_bottom_y - 20 <= cand_top_y <= label_bottom_y + 260
        ):
            vertical_dist = abs(cand_top_y - (label_bottom_y + 35))
            horizontal_dist = abs(cand_center_x - label_center_x)
            candidates.append((vertical_dist + 0.6 * horizontal_dist, -cand_height, clean_text))

    candidates.sort(key=lambda x: (x[0], x[1]))
    return candidates[0][2] if candidates else None

def extract_handle(results):
    for (bbox, text, prob) in results:
        t = text.strip()
        if t.startswith('@') and len(t) > 3:
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
                    self.role_name = None
            except ValueError:
                self.role_name = None

# ============================================================
# Discord bot (Slash commands + V2 replies)
# ============================================================
intents = discord.Intents.default()
intents.guilds = True
intents.message_content = False

client = discord.Client(intents=intents)
tree = discord.app_commands.CommandTree(client)

SYNCED_COMMANDS = {}

def slash_cmd_mention(name: str) -> str:
    cmd = SYNCED_COMMANDS.get(name)
    if not cmd:
        return f"`/{name}`"

    mention = getattr(cmd, "mention", None)
    if mention:
        return mention

    cmd_id = getattr(cmd, "id", None)
    if cmd_id:
        return f"</{name}:{cmd_id}>"

    return f"`/{name}`"

def _require_verify_channel(interaction: discord.Interaction) -> bool:
    return (VERIFY_CHANNEL_ID == 0) or (interaction.channel_id == VERIFY_CHANNEL_ID)

def _result_color(result: VerificationResult) -> int:
    if result.handle_match_error:
        return 0xED4245
    if result.detected_score:
        return 0x57F287
    return 0xED4245

class XLinkLayout(discord.ui.LayoutView):
    def __init__(self, link: str, verify_mention: str):
        super().__init__(timeout=LINK_TTL)

        container = discord.ui.Container(accent_color=0x1DA1F2)

        container.add_item(
            discord.ui.TextDisplay("**🔗 Link Your X Account**")
        )

        container.add_item(
            discord.ui.TextDisplay(
                "To use verification, you must link your X account."
            )
        )

        row = discord.ui.ActionRow()
        row.add_item(
            discord.ui.Button(
                label="Connect X Account",
                style=discord.ButtonStyle.link,
                url=link,
                emoji="🔵",
            )
        )
        container.add_item(row)

        container.add_item(
            discord.ui.TextDisplay(
                "After you see ✅ **Success** in your browser, come back here "
                f"and click {verify_mention} to auto-open the verification command."
            )
        )

        container.add_item(
            discord.ui.TextDisplay("⏱️ Link expires in 10 minutes")
        )

        self.add_item(container)

class SuperCampaignLayout(discord.ui.LayoutView):
    def __init__(self, link: str, verify_mention: str):
        super().__init__(timeout=LINK_TTL)

        container = discord.ui.Container(accent_color=0x1DA1F2)

        container.add_item(
            discord.ui.TextDisplay(
                "# <:004:1420713409346928650>  Gmindo, to obtain all benefits from our new campaign follow this steps!"
            )
        )

        container.add_item(
            discord.ui.TextDisplay(
                "**1.** Click on **Connect X Account** button"
            )
        )

        row = discord.ui.ActionRow()
        row.add_item(
            discord.ui.Button(
                label="Connect X Account",
                style=discord.ButtonStyle.link,
                url=link,
                emoji="🔵",
            )
        )
        container.add_item(row)

        container.add_item(
            discord.ui.TextDisplay(
                f"**2.** After that click {verify_mention} and attach image with your previous score "
                "from **Kaito, Wallchain, Cookie, Xeet**"
            )
        )

        container.add_item(
            discord.ui.TextDisplay(
                "**3.** Obtain one of 3 roles based on your previous KOL achievements\n\n"
                f"{SMALLER_IMPACT_ROLE_MENTION} - for smaller impact on X space\n"
                f"{MID_IMPACT_ROLE_TEXT} - for mid impact\n"
                f"{TOP_IMPACT_ROLE_MENTION} - for the top impact"
            )
        )

        self.add_item(container)

class VerificationResultLayout(discord.ui.LayoutView):
    def __init__(
        self,
        member: discord.Member,
        x_link: dict | None,
        result: VerificationResult,
        role_note: str | None = None,
        profile_card_url: str | None = None,
    ):
        super().__init__(timeout=LINK_TTL)

        container = discord.ui.Container(accent_color=_result_color(result))

        if result.handle_match_error:
            status_text = (
                f"❌ **Identity Mismatch**\n"
                f"{result.handle_match_error}\n"
                f"This screenshot does not belong to your linked account."
            )
        elif result.detected_score:
            status_text = f"✅ **Verification Successful**\nFound **{result.project}** score!"
        else:
            status_text = (
                f"❌ **Verification Failed**\n"
                f"Could not detect a **{result.project}** score.\n"
                f"Please ensure the image is clear and uncropped."
            )

        container.add_item(
            discord.ui.TextDisplay(f"**{member.display_name}**")
        )

        if profile_card_url:
            container.add_item(
                discord.ui.MediaGallery(
                    MediaGalleryItem(
                        profile_card_url,
                        description="Linked X profile card",
                    )
                )
            )

        container.add_item(
            discord.ui.TextDisplay(status_text)
        )

        details = []
        if result.detected_score:
            details.append(f"**🎯 Score**\n`{result.detected_score}`")
        if result.role_name:
            details.append(f"**🎭 Role**\n`{result.role_name}`")

        if x_link:
            x_user = x_link.get("x_username")
            x_name = (x_link.get("x_name") or x_user or "").strip()
            x_handle = f"[@{x_user}](https://x.com/{x_user})"
            is_verified = bool(x_link.get("verified")) or (
                str(x_link.get("verified_type") or "").lower() in {"blue", "business", "government"}
            )
            if is_verified:
                x_handle += " ☑️"
            details.append(f"**🔗 X Account**\n{x_name}\n{x_handle}")
        else:
            details.append("**🔗 X Account**\n*Not Linked*")

        if details:
            container.add_item(
                discord.ui.TextDisplay("\n\n".join(details))
            )

        if role_note:
            container.add_item(
                discord.ui.TextDisplay(f"**⚠️ Role assignment**\n{role_note}")
            )

        container.add_item(
            discord.ui.TextDisplay("Mindo AI Verifier")
        )

        self.add_item(container)

def build_link_layout(link: str) -> discord.ui.LayoutView:
    verify_mention = slash_cmd_mention("verify")
    return XLinkLayout(link, verify_mention)

def build_super_layout(link: str) -> discord.ui.LayoutView:
    verify_mention = slash_cmd_mention("verify")
    return SuperCampaignLayout(link, verify_mention)

def build_result_layout(
    member: discord.Member,
    x_link: dict | None,
    result: VerificationResult,
    role_note: str | None = None,
    profile_card_url: str | None = None,
) -> discord.ui.LayoutView:
    return VerificationResultLayout(member, x_link, result, role_note, profile_card_url)

async def ensure_tier_roles(guild: discord.Guild) -> dict:
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
    if role_name not in TIER_ROLE_NAMES:
        return False, "Invalid tier role name."

    guild = member.guild
    roles_map = await ensure_tier_roles(guild)
    target_role = roles_map.get(role_name)

    if target_role is None:
        return False, (
            "I don't have permission to create/manage roles. "
            "Please grant **Manage Roles** and place my bot role above the tier roles."
        )

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
        return False, (
            "I don't have permission to modify your roles. "
            "Check role hierarchy (my role must be above tier roles)."
        )

    return True, "Role assigned."

# -----------------------------
# Slash commands
# -----------------------------
@tree.command(name="xlink", description="Link your X account for verification")
async def xlink_cmd(interaction: discord.Interaction):
    if not interaction.user:
        return

    await database.upsert_user_identity(str(interaction.user.id), str(interaction.user))
    link = await create_signed_start_link(str(interaction.user.id))
    layout = build_link_layout(link)

    await interaction.response.send_message(
        view=layout,
        ephemeral=True,
    )

@tree.command(name="super", description="Show campaign onboarding steps")
async def super_cmd(interaction: discord.Interaction):
    if not interaction.user:
        return

    await database.upsert_user_identity(str(interaction.user.id), str(interaction.user))
    link = await create_signed_start_link(str(interaction.user.id))
    layout = build_super_layout(link)

    await interaction.response.send_message(
        view=layout,
        ephemeral=True,
    )

@tree.command(name="xstatus", description="Show your linked X account status")
async def xstatus_cmd(interaction: discord.Interaction):
    await database.upsert_user_identity(str(interaction.user.id), str(interaction.user))
    obj = await link_get(str(interaction.user.id))
    if not obj:
        await interaction.response.send_message(
            "You have not linked X yet. Use `/super` and press **Connect X Account**.",
            ephemeral=True,
        )
        return

    verify_mention = slash_cmd_mention("verify")
    username = (obj.get("x_username") or "").strip()
    display_name = (obj.get("x_name") or username or "X user").strip()
    layout = build_linked_profile_layout(
        display_name,
        username,
        None,
        verified=bool(obj.get("verified")),
        verified_type=obj.get("verified_type"),
        footer_text=f"Use {verify_mention} in the server to continue verification.",
    )

    await interaction.response.send_message(view=layout, ephemeral=True)

@tree.command(name="xunlink", description="Unlink your X account")
async def xunlink_cmd(interaction: discord.Interaction):
    await database.upsert_user_identity(str(interaction.user.id), str(interaction.user))
    removed = await link_delete(str(interaction.user.id))
    remove_profile_assets(str(interaction.user.id))
    await interaction.response.send_message("✅ Unlinked." if removed else "You were not linked.", ephemeral=True)

@tree.command(name="verify", description="Upload a screenshot for verification (ephemeral)")
@discord.app_commands.describe(image="Upload a screenshot (PNG/JPG)")
async def verify_cmd(interaction: discord.Interaction, image: discord.Attachment):
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        await interaction.response.send_message("This command can only be used in a server.", ephemeral=True)
        return

    if not _require_verify_channel(interaction):
        await interaction.response.send_message(
            "Please use `/verify` in the designated verification channel.",
            ephemeral=True
        )
        return

    if not (image.content_type and image.content_type.startswith("image/")):
        await interaction.response.send_message("Please upload a valid image file.", ephemeral=True)
        return

    await database.upsert_user_identity(str(interaction.user.id), str(interaction.user))

    x_link = await link_get(str(interaction.user.id))
    if not x_link:
        link = await create_signed_start_link(str(interaction.user.id))
        layout = build_link_layout(link)

        await interaction.response.send_message(
            view=layout,
            ephemeral=True,
        )
        return

    await interaction.response.defer(ephemeral=True, thinking=True)

    try:
        image_bytes = await image.read()

        async with OCR_SEMAPHORE:
            loop = asyncio.get_event_loop()
            ocr_started = time.perf_counter()
            results = await loop.run_in_executor(None, run_ocr, image_bytes)
            print(f"OCR finished in {time.perf_counter() - ocr_started:.2f}s for user {interaction.user.id}")

        project = classify_project(results)

        score_val = None
        if project == "Wallchain":
            score_val = extract_wallchain_score(results)
        elif project == "Kaito":
            score_val = extract_kaito_score(results)
        elif project == "Xeet":
            score_val = extract_xeet_score(results)
        elif project == "Cookie":
            score_val = extract_cookie_score(results)
        elif project == "Mindoshare":
            score_val = extract_mindoshare_score(results)
        else:
            score_val = (
                extract_mindoshare_score(results)
                or extract_wallchain_score(results)
                or extract_kaito_score(results)
            )

        handle_error = None
        img_handle = extract_handle(results)
        required_handle = (x_link.get("x_username") or "").lower()
        if img_handle and img_handle.lower() != required_handle:
            handle_error = f"Found @{img_handle} in image, but your linked account is @{required_handle}"

        result = VerificationResult(score_val, project, handle_match_error=handle_error)

        role_note = None
        if result.role_name and not result.handle_match_error:
            ok, msg = await assign_tier_role(interaction.user, result.role_name)
            if not ok:
                role_note = msg

        await database.log_result(
            discord_id=str(interaction.user.id),
            discord_username=str(interaction.user),
            guild_id=str(interaction.guild.id),
            project=project,
            score=str(score_val) if score_val else None,
            role_assigned=result.role_name
        )

        x_username = (x_link.get("x_username") or "").strip()
        x_display_name = (x_link.get("x_name") or x_username or interaction.user.display_name).strip()
        profile_image_url = (x_link.get("profile_image_url") or "").strip() or None
        if profile_image_url:
            try:
                await _ensure_cached_linked_profile_avatar(str(interaction.user.id), profile_image_url)
            except Exception as exc:
                print(f"Failed to refresh linked profile avatar during verify: {exc}")
        profile_card_path = ensure_profile_card(
            str(interaction.user.id),
            x_display_name,
            x_username or interaction.user.display_name,
            verified=bool(x_link.get("verified")),
            verified_type=x_link.get("verified_type"),
        )

        profile_card_url = None
        followup_kwargs = {
            "ephemeral": True,
        }
        if profile_card_path and os.path.exists(profile_card_path):
            profile_card_url = f"attachment://{CARD_ATTACHMENT_NAME}"
            followup_kwargs["file"] = discord.File(profile_card_path, filename=CARD_ATTACHMENT_NAME)

        result_layout = build_result_layout(
            interaction.user,
            x_link,
            result,
            role_note,
            profile_card_url,
        )
        followup_kwargs["view"] = result_layout

        await interaction.followup.send(**followup_kwargs)

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

    try:
        if DISCORD_GUILD_ID:
            guild_obj = discord.Object(id=DISCORD_GUILD_ID)
            tree.copy_global_to(guild=guild_obj)
            synced = await tree.sync(guild=guild_obj)
            print(f"Slash commands synced to guild {DISCORD_GUILD_ID}.")
        else:
            synced = await tree.sync()
            print("Slash commands synced globally (may take time to appear).")

        SYNCED_COMMANDS.clear()
        for cmd in synced:
            SYNCED_COMMANDS[cmd.name] = cmd

        print("Cached slash command mentions:", ", ".join(SYNCED_COMMANDS.keys()))

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
