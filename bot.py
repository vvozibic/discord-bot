import discord
import asyncio
import re
import config
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
import numpy as np
import cv2
from paddleocr import PaddleOCR
from concurrent.futures import ProcessPoolExecutor

# ============================================================
# Config & Setup
# ============================================================
X_CLIENT_ID = getattr(config, "X_CLIENT_ID", os.getenv("X_CLIENT_ID", "")).strip()
X_CLIENT_SECRET = getattr(config, "X_CLIENT_SECRET", os.getenv("X_CLIENT_SECRET", "")).strip()
X_REDIRECT_URI = getattr(config, "X_REDIRECT_URI", os.getenv("X_REDIRECT_URI", "")).strip()
LINK_SECRET = getattr(config, "LINK_SECRET", os.getenv("LINK_SECRET", "default-secret-change-me")).strip()
DISCORD_TOKEN = getattr(config, "DISCORD_TOKEN", os.getenv("DISCORD_TOKEN", "")).strip()
DISCORD_GUILD_ID = int(getattr(config, "DISCORD_GUILD_ID", os.getenv("DISCORD_GUILD_ID", "0")) or 0)
VERIFY_CHANNEL_ID = int(getattr(config, "VERIFY_CHANNEL_ID", os.getenv("VERIFY_CHANNEL_ID", "0")) or 0)

# OCR Concurrency & Multi-processing
OCR_CONCURRENCY = int(getattr(config, "OCR_CONCURRENCY", os.getenv("OCR_CONCURRENCY", "4")) or 4)
executor = ProcessPoolExecutor(max_workers=OCR_CONCURRENCY)

# Role tier names
TIER_ROLE_NAMES = ["Signal Lite", "Signal Amplifier", "Top Signal"]

# Initialize PaddleOCR (CPU mode)
paddle_reader = PaddleOCR(use_angle_cls=False, lang='en', show_log=False, use_gpu=False)

def run_paddle_ocr(image_bytes):
    """Worker function for high-speed OCR processing."""
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    result = paddle_reader.ocr(img, cls=False)
    
    formatted = []
    if result and result[0]:
        for line in result[0]:
            # line structure: [ [bbox], (text, prob) ]
            # Paddle BBox: [[x1,y1], [x2,y1], [x2,y2], [x1,y2]]
            formatted.append((line[0], line[1][0], line[1][1]))
    return formatted

# ============================================================
# Specialized Identification Logic
# ============================================================

def classify_project(results):
    text_blob = " ".join([t[1].lower() for t in results])
    if any(k in text_blob for k in ["wallchain", "quacks", "quack balance"]): return "Wallchain"
    if any(k in text_blob for k in ["kaito", "total yaps", "earned yaps"]): return "Kaito"
    if any(k in text_blob for k in ["xeet", "xeets earned"]): return "Xeet"
    if any(k in text_blob for k in ["cookie", "snaps earned", "total snaps"]): return "Cookie"
    if any(k in text_blob for k in ["kol score", "mindoshare"]): return "Mindoshare"
    return "Unknown"

def extract_handle(results):
    for (bbox, text, prob) in results:
        t = text.strip()
        if t.startswith('@') and len(t) > 3:
            return t.lstrip('@').strip().strip('.,;:!)]}(')
    return None

def extract_wallchain_score(results):
    # Specialized: Look for 'Score' label then search in corridor directly below
    score_bbox = next((bbox for bbox, text, _ in results if text.strip().lower() == "score"), None)
    if not score_bbox: return None
    
    cx = (score_bbox[0][0] + score_bbox[1][0]) / 2
    bot_y = score_bbox[2][1]
    
    candidates = []
    for bbox, text, _ in results:
        clean = text.strip().replace(',', '')
        if re.match(r'^\d+(\.\d+)?$', clean):
            cand_cx = (bbox[0][0] + bbox[1][0]) / 2
            cand_top_y = bbox[0][1]
            if abs(cand_cx - cx) < 100 and cand_top_y >= bot_y:
                candidates.append((cand_top_y - bot_y, clean))
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1] if candidates else None

def extract_cookie_score(results):
    # Specialized: Euclidean distance search because Cookie UI is tiled/circular
    label_bbox = None
    for bbox, text, _ in results:
        t = text.lower()
        if "snaps" in t or "earned" in t:
            label_bbox = bbox
            break
    if not label_bbox: return None

    l_cx = (label_bbox[0][0] + label_bbox[1][0]) / 2
    l_cy = (label_bbox[0][1] + label_bbox[2][1]) / 2

    candidates = []
    for bbox, text, _ in results:
        clean = text.strip().replace(',', '')
        if re.match(r'^\d+(\.\d+)?$', clean):
            c_cx = (bbox[0][0] + bbox[1][0]) / 2
            c_cy = (bbox[0][1] + bbox[2][1]) / 2
            dist = ((c_cx - l_cx)**2 + (c_cy - l_cy)**2)**0.5
            if dist < 300:
                candidates.append((dist, clean))
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1] if candidates else None

def extract_kaito_score(results):
    # Specialized: Vertical corridor below 'Total Yaps'
    label_bbox = None
    for bbox, text, _ in results:
        t = text.lower()
        if "total" in t and "yaps" in t:
            label_bbox = bbox
            break
    if not label_bbox: return None

    l_cx = (label_bbox[0][0] + label_bbox[1][0]) / 2
    l_bot_y = label_bbox[2][1]

    candidates = []
    for bbox, text, _ in results:
        clean = text.strip().replace(',', '')
        if re.match(r'^\d+(\.\d+)?$', clean):
            c_cx = (bbox[0][0] + bbox[1][0]) / 2
            c_top_y = bbox[0][1]
            if abs(c_cx - l_cx) < 300 and c_top_y >= l_bot_y:
                candidates.append((c_top_y - l_bot_y, clean))
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1] if candidates else None

# ============================================================
# Result Processing & Role Assignment
# ============================================================

class VerificationResult:
    def __init__(self, detected_score, project="Unknown", handle_match_error=None):
        self.detected_score = detected_score
        self.project = project
        self.handle_match_error = handle_match_error
        self.role_name = None

        if detected_score and not handle_match_error:
            try:
                val = float(str(detected_score))
                if project == "Kaito":
                    if 50 < val < 200: self.role_name = "Signal Lite"
                    elif 200 <= val < 1000: self.role_name = "Signal Amplifier"
                    elif val >= 1000: self.role_name = "Top Signal"
                elif project == "Wallchain":
                    if 10 < val <= 75: self.role_name = "Signal Lite"
                    elif 76 <= val <= 400: self.role_name = "Signal Amplifier"
                    elif val >= 401: self.role_name = "Top Signal"
                elif project == "Cookie":
                    if 10 <= val <= 200: self.role_name = "Signal Lite"
                    elif 201 <= val <= 400: self.role_name = "Signal Amplifier"
                    elif val >= 401: self.role_name = "Top Signal"
                elif project == "Xeet":
                    if 100 <= val <= 300: self.role_name = "Signal Lite"
                    elif 301 <= val < 1100: self.role_name = "Signal Amplifier"
                    elif val >= 1100: self.role_name = "Top Signal"
            except: pass

async def assign_tier_role(member: discord.Member, role_name: str):
    # Place your existing assign_tier_role function code here
    pass

# ============================================================
# Discord Commands
# ============================================================
intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = discord.app_commands.CommandTree(client)

@tree.command(name="verify", description="Fast X Screenshot Verification")
async def verify_cmd(interaction: discord.Interaction, image: discord.Attachment):
    if not interaction.guild: return
    
    x_link = await database.get_link(str(interaction.user.id))
    if not x_link:
        await interaction.response.send_message("❌ Link your X account first using `/xlink`.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True, thinking=True)

    try:
        image_bytes = await image.read()
        
        # Parallel OCR Processing
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(executor, run_paddle_ocr, image_bytes)

        project = classify_project(results)
        
        # Specialized Extraction Mapping
        if project == "Wallchain": score_val = extract_wallchain_score(results)
        elif project == "Cookie": score_val = extract_cookie_score(results)
        elif project == "Kaito": score_val = extract_kaito_score(results)
        else:
            # Fallback to general nearest-number logic if project is Xeet/Mindoshare
            score_val = extract_kaito_score(results) # Example fallback

        img_handle = extract_handle(results)
        required_handle = (x_link.get("x_username") or "").lower()
        handle_error = None
        if img_handle and img_handle.lower() != required_handle:
            handle_error = f"Screenshot shows @{img_handle}, but your linked X is @{required_handle}"

        result = VerificationResult(score_val, project, handle_error)

        if result.role_name and not handle_error:
            await assign_tier_role(interaction.user, result.role_name)

        await database.log_result(
            discord_id=str(interaction.user.id),
            discord_username=str(interaction.user),
            guild_id=str(interaction.guild.id),
            project=project,
            score=score_val,
            role_assigned=result.role_name
        )

        # Assuming you'll use your build_result_embed function here
        status_msg = "✅ Success!" if result.role_name else "❌ Score not detected or low."
        await interaction.followup.send(f"{status_msg}\n**Project:** {project}\n**Score:** {score_val}", ephemeral=True)

    except Exception as e:
        await interaction.followup.send(f"❌ System error during OCR: {e}", ephemeral=True)

@client.event
async def on_ready():
    await database.init_db()
    if DISCORD_GUILD_ID:
        guild = discord.Object(id=DISCORD_GUILD_ID)
        tree.copy_global_to(guild=guild)
        await tree.sync(guild=guild)
    print(f"Logged in as {client.user} | OCR Ready on {os.cpu_count()} cores.")

if __name__ == "__main__":
    client.run(DISCORD_TOKEN)
