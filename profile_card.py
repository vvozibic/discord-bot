import io
import os
import tempfile
from pathlib import Path

import discord
from PIL import Image, ImageDraw, ImageFont, ImageOps


CARD_ATTACHMENT_NAME = "linked-profile-card.png"
CARD_CACHE_DIR = Path(
    os.getenv("PROFILE_CARD_CACHE_DIR", Path(tempfile.gettempdir()) / "mindo_profile_cards")
)
CARD_SIZE = (1200, 630)


def _load_font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_candidates = [
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
    ]

    windows_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    if bold:
        font_candidates.extend(
            [
                str(windows_fonts / "segoeuib.ttf"),
                str(windows_fonts / "arialbd.ttf"),
                str(windows_fonts / "calibrib.ttf"),
            ]
        )
    else:
        font_candidates.extend(
            [
                str(windows_fonts / "segoeui.ttf"),
                str(windows_fonts / "arial.ttf"),
                str(windows_fonts / "calibri.ttf"),
            ]
        )

    for font_name in font_candidates:
        try:
            return ImageFont.truetype(font_name, size)
        except OSError:
            continue

    return ImageFont.load_default()


def _fit_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    *,
    size: int,
    min_size: int,
    bold: bool = False,
) -> tuple[str, ImageFont.FreeTypeFont | ImageFont.ImageFont]:
    clean_text = " ".join((text or "").split()) or "Unknown User"

    for current_size in range(size, min_size - 1, -2):
        font = _load_font(current_size, bold=bold)
        width = draw.textbbox((0, 0), clean_text, font=font)[2]
        if width <= max_width:
            return clean_text, font

    font = _load_font(min_size, bold=bold)
    trimmed = clean_text
    while len(trimmed) > 3:
        candidate = trimmed.rstrip() + "..."
        width = draw.textbbox((0, 0), candidate, font=font)[2]
        if width <= max_width:
            return candidate, font
        trimmed = trimmed[:-1]

    return "...", font


def _verified_badge(verified: bool, verified_type: str | None) -> str:
    if verified or str(verified_type or "").lower() in {"blue", "business", "government"}:
        return " VERIFIED"
    return ""


def _initials(display_name: str, username: str) -> str:
    source = (display_name or username or "X").strip()
    parts = [part for part in source.replace("@", " ").split() if part]
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    return source[:2].upper()


def _sanitize_discord_id(discord_id: str) -> str:
    safe = "".join(ch for ch in str(discord_id) if ch.isalnum() or ch in {"-", "_"})
    return safe or "unknown-user"


def _card_path(discord_id: str) -> Path:
    CARD_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CARD_CACHE_DIR / f"{_sanitize_discord_id(discord_id)}.png"


def get_profile_card_path(discord_id: str) -> str | None:
    path = _card_path(discord_id)
    return str(path) if path.exists() else None


def _make_avatar_image(
    avatar_bytes: bytes | None,
    display_name: str,
    username: str,
    size: int,
) -> Image.Image:
    if avatar_bytes:
        avatar = Image.open(io.BytesIO(avatar_bytes)).convert("RGBA")
        avatar = ImageOps.fit(avatar, (size, size), Image.Resampling.LANCZOS)
    else:
        avatar = Image.new("RGBA", (size, size), (49, 46, 129, 255))
        draw = ImageDraw.Draw(avatar)
        draw.ellipse((0, 0, size - 1, size - 1), fill=(56, 189, 248, 255))
        initials_font = _load_font(max(44, size // 3), bold=True)
        initials = _initials(display_name, username)
        bbox = draw.textbbox((0, 0), initials, font=initials_font)
        initials_x = (size - (bbox[2] - bbox[0])) / 2
        initials_y = (size - (bbox[3] - bbox[1])) / 2 - 8
        draw.text((initials_x, initials_y), initials, font=initials_font, fill=(4, 12, 24, 255))

    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    avatar.putalpha(mask)
    return avatar


def render_profile_card(
    display_name: str,
    username: str,
    avatar_bytes: bytes | None = None,
    *,
    verified: bool = False,
    verified_type: str | None = None,
) -> bytes:
    width, height = CARD_SIZE
    canvas = Image.new("RGBA", (width, height), (7, 11, 24, 255))

    glow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)
    glow_draw.ellipse((-80, -120, 520, 420), fill=(29, 161, 242, 60))
    glow_draw.ellipse((760, 120, 1280, 760), fill=(20, 184, 166, 45))
    canvas = Image.alpha_composite(canvas, glow_layer)

    draw = ImageDraw.Draw(canvas)
    panel_bounds = (42, 42, width - 42, height - 42)
    draw.rounded_rectangle(panel_bounds, radius=42, fill=(12, 18, 34, 230), outline=(43, 60, 86, 255), width=2)
    draw.rounded_rectangle((62, 62, 80, height - 62), radius=10, fill=(56, 189, 248, 255))

    title_font = _load_font(30, bold=True)
    label_font = _load_font(22, bold=False)
    badge_font = _load_font(22, bold=True)
    meta_font = _load_font(20, bold=False)

    draw.text((110, 92), "MINDO AI", font=title_font, fill=(125, 211, 252, 255))
    draw.text((110, 136), "Linked X profile", font=label_font, fill=(148, 163, 184, 255))

    badge_text = "X CONNECTED" + _verified_badge(verified, verified_type)
    badge_bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
    badge_width = badge_bbox[2] - badge_bbox[0] + 34
    badge_left = width - badge_width - 96
    draw.rounded_rectangle((badge_left, 92, badge_left + badge_width, 138), radius=22, fill=(15, 118, 110, 255))
    draw.text((badge_left + 18, 102), badge_text, font=badge_font, fill=(229, 255, 250, 255))

    avatar_size = 190
    avatar = _make_avatar_image(avatar_bytes, display_name, username, avatar_size)
    avatar_x = 118
    avatar_y = 228
    avatar_shadow = Image.new("RGBA", (avatar_size + 24, avatar_size + 24), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(avatar_shadow)
    shadow_draw.ellipse((12, 12, avatar_size + 12, avatar_size + 12), fill=(15, 23, 42, 180))
    canvas.alpha_composite(avatar_shadow, (avatar_x - 12, avatar_y - 4))
    canvas.alpha_composite(avatar, (avatar_x, avatar_y))

    text_x = 362
    text_width = width - text_x - 112
    fitted_name, name_font = _fit_text(draw, display_name or username, text_width, size=64, min_size=40, bold=True)
    draw.text((text_x, 246), fitted_name, font=name_font, fill=(248, 250, 252, 255))

    fitted_handle, handle_font = _fit_text(
        draw,
        f"@{(username or '').lstrip('@')}",
        text_width,
        size=36,
        min_size=24,
        bold=False,
    )
    draw.text((text_x, 334), fitted_handle, font=handle_font, fill=(56, 189, 248, 255))

    draw.text(
        (text_x, 408),
        "This identity was linked through X OAuth and is ready for verification.",
        font=meta_font,
        fill=(203, 213, 225, 255),
    )
    draw.text(
        (text_x, 452),
        "Use /verify in Discord to submit your KOL score screenshot.",
        font=meta_font,
        fill=(148, 163, 184, 255),
    )

    footer_y = height - 104
    draw.line((110, footer_y, width - 110, footer_y), fill=(43, 60, 86, 255), width=2)
    draw.text((110, footer_y + 24), "Signal profile card", font=label_font, fill=(148, 163, 184, 255))
    draw.text((width - 298, footer_y + 24), "x.com/" + (username or "").lstrip("@"), font=label_font, fill=(125, 211, 252, 255))

    buffer = io.BytesIO()
    canvas.convert("RGB").save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def save_profile_card(
    discord_id: str,
    display_name: str,
    username: str,
    avatar_bytes: bytes | None = None,
    *,
    verified: bool = False,
    verified_type: str | None = None,
) -> str:
    card_bytes = render_profile_card(
        display_name,
        username,
        avatar_bytes,
        verified=verified,
        verified_type=verified_type,
    )
    path = _card_path(discord_id)
    path.write_bytes(card_bytes)
    return str(path)


def ensure_profile_card(
    discord_id: str,
    display_name: str,
    username: str,
    *,
    verified: bool = False,
    verified_type: str | None = None,
) -> str:
    existing = get_profile_card_path(discord_id)
    if existing:
        return existing
    return save_profile_card(
        discord_id,
        display_name,
        username,
        None,
        verified=verified,
        verified_type=verified_type,
    )


def build_linked_profile_layout(
    display_name: str,
    username: str,
    profile_image_url: str | None = None,
    *,
    verified: bool = False,
    verified_type: str | None = None,
    footer_text: str | None = None,
) -> discord.ui.LayoutView:
    view = discord.ui.LayoutView(timeout=None)

    verified_badge = ""
    if verified or str(verified_type or "").lower() in {"blue", "business", "government"}:
        verified_badge = " ☑️"

    profile_text = f"**{display_name}{verified_badge}**\n[@{username}](https://x.com/{username})"

    items: list[discord.ui.Item] = [
        discord.ui.TextDisplay("**✅ X Account Linked**"),
    ]

    if profile_image_url:
        items.append(
            discord.ui.Section(
                discord.ui.TextDisplay(profile_text),
                accessory=discord.ui.Thumbnail(
                    profile_image_url,
                    description=f"Avatar for @{username}",
                ),
            )
        )
    else:
        items.append(discord.ui.TextDisplay(profile_text))

    items.append(
        discord.ui.TextDisplay(
            "Your X identity is connected to Mindo AI. Use `/verify` in the server "
            "and upload your score screenshot to continue."
        )
    )

    if footer_text:
        items.append(discord.ui.TextDisplay(footer_text))

    row = discord.ui.ActionRow()
    row.add_item(
        discord.ui.Button(
            label="Open X Profile",
            style=discord.ButtonStyle.link,
            url=f"https://x.com/{username}",
            emoji="🔵",
        )
    )
    items.append(row)

    container = discord.ui.Container(*items, accent_color=0x1DA1F2)
    view.add_item(container)
    return view
