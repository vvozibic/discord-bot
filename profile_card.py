import os
import subprocess
import tempfile
from pathlib import Path
from shutil import which

import discord
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


CARD_ATTACHMENT_NAME = "linked-profile-card.png"
PROFILE_CARD_CACHE_DIR = Path(
    os.getenv("PROFILE_CARD_CACHE_DIR", Path(tempfile.gettempdir()) / "mindo_profile_card_cache")
)
PROFILE_CARD_BADGE_TEXT = os.getenv("PROFILE_CARD_BADGE_TEXT", "Mindo Early Believer")
NODE_BIN = os.getenv("NODE_BIN", "").strip()
RENDERER_SCRIPT = Path(__file__).resolve().parent / "renderer" / "render-profile-card.mjs"
TEMPLATE_PATH = Path(__file__).resolve().parent / "renderer" / "templates" / "mindoshare-social-card.jpg"
BASE_TEMPLATE_WIDTH = 850
BASE_TEMPLATE_HEIGHT = 1536

_AVATAR_DIR = PROFILE_CARD_CACHE_DIR / "avatars"
_CARD_DIR = PROFILE_CARD_CACHE_DIR / "cards"


def _sanitize_discord_id(discord_id: str) -> str:
    safe = "".join(ch for ch in str(discord_id) if ch.isalnum() or ch in {"-", "_"})
    return safe or "unknown-user"


def _ensure_cache_dirs() -> None:
    _AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    _CARD_DIR.mkdir(parents=True, exist_ok=True)


def _avatar_glob(discord_id: str) -> list[Path]:
    user_key = _sanitize_discord_id(discord_id)
    return sorted(_AVATAR_DIR.glob(f"{user_key}.*"))


def _card_path(discord_id: str) -> Path:
    return _CARD_DIR / f"{_sanitize_discord_id(discord_id)}.png"


def _resolve_node_bin() -> str | None:
    if NODE_BIN:
        return NODE_BIN

    for candidate in ("node", "nodejs"):
        resolved = which(candidate)
        if resolved:
            return resolved

    return None


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
        bbox = draw.textbbox((0, 0), clean_text, font=font)
        width = bbox[2] - bbox[0]
        if width <= max_width:
            return clean_text, font

    font = _load_font(min_size, bold=bold)
    trimmed = clean_text
    while len(trimmed) > 3:
        candidate = trimmed.rstrip() + "..."
        bbox = draw.textbbox((0, 0), candidate, font=font)
        width = bbox[2] - bbox[0]
        if width <= max_width:
            return candidate, font
        trimmed = trimmed[:-1]

    return "...", font


def _initials(display_name: str, username: str) -> str:
    source = (display_name or username or "X").replace("@", " ").strip()
    parts = [part for part in source.split() if part]
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    return source[:2].upper()


def _draw_centered_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    center_x: float,
    top_y: int,
    *,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: str,
) -> None:
    bbox = draw.textbbox((0, 0), text, font=font)
    width = bbox[2] - bbox[0]
    draw.text((center_x - width / 2, top_y), text, font=font, fill=fill)


def _build_avatar_image(
    avatar_path: str | None,
    display_name: str,
    username: str,
    size: int,
) -> Image.Image:
    if avatar_path and Path(avatar_path).exists():
        with Image.open(avatar_path) as source:
            avatar = ImageOps.fit(source.convert("RGBA"), (size, size), Image.Resampling.LANCZOS)
    else:
        avatar = Image.new("RGBA", (size, size), "#22d3ee")
        draw = ImageDraw.Draw(avatar)
        initials_font = _load_font(max(30, size // 3), bold=True)
        initials = _initials(display_name, username)
        bbox = draw.textbbox((0, 0), initials, font=initials_font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        draw.text(
            ((size - text_width) / 2, (size - text_height) / 2 - size * 0.04),
            initials,
            font=initials_font,
            fill="#02131a",
        )

    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    avatar.putalpha(mask)
    return avatar


def _render_profile_card_with_pillow(
    card_path: Path,
    display_name: str,
    username: str,
    avatar_path: str | None,
) -> None:
    with Image.open(TEMPLATE_PATH) as source:
        canvas = source.convert("RGBA")

    width, height = canvas.size
    center_x = width / 2
    scale_x = width / BASE_TEMPLATE_WIDTH
    scale_y = height / BASE_TEMPLATE_HEIGHT
    scale = min(scale_x, scale_y)

    avatar_size = max(132, round(220 * scale))
    avatar_y = round(228 * scale_y)
    avatar_x = round(center_x - avatar_size / 2)

    shadow = Image.new("RGBA", (avatar_size + 48, avatar_size + 48), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.ellipse((20, 18, avatar_size + 20, avatar_size + 18), fill=(6, 34, 18, 148))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=max(8, round(16 * scale))))
    canvas.alpha_composite(shadow, (avatar_x - 24, avatar_y - 8))

    avatar = _build_avatar_image(avatar_path, display_name, username, avatar_size)
    canvas.alpha_composite(avatar, (avatar_x, avatar_y))

    draw = ImageDraw.Draw(canvas)
    fitted_name, name_font = _fit_text(
        draw,
        display_name or username or "X User",
        width - round(120 * scale_x),
        size=max(40, round(68 * scale)),
        min_size=max(28, round(34 * scale)),
        bold=True,
    )
    _draw_centered_text(
        draw,
        fitted_name,
        center_x,
        round(578 * scale_y),
        font=name_font,
        fill="#f8fafc",
    )

    handle_text = f"@{(username or '').lstrip('@')}"
    fitted_handle, handle_font = _fit_text(
        draw,
        handle_text,
        width - round(130 * scale_x),
        size=max(28, round(50 * scale)),
        min_size=max(22, round(30 * scale)),
        bold=False,
    )
    _draw_centered_text(
        draw,
        fitted_handle,
        center_x,
        round(670 * scale_y),
        font=handle_font,
        fill="#f4f4f5",
    )

    canvas.convert("RGB").save(card_path, format="PNG", optimize=True)


def _render_profile_card_with_node(
    card_path: Path,
    display_name: str,
    username: str,
    avatar_path: str | None,
    *,
    verified: bool = False,
    verified_type: str | None = None,
) -> None:
    node_bin = _resolve_node_bin()
    if not node_bin:
        raise FileNotFoundError("node")
    if not RENDERER_SCRIPT.exists():
        raise RuntimeError(f"Profile card renderer is missing: {RENDERER_SCRIPT}")

    command = [
        node_bin,
        str(RENDERER_SCRIPT),
        "--template",
        str(TEMPLATE_PATH),
        "--output",
        str(card_path),
        "--display-name",
        display_name,
        "--username",
        username,
        "--badge-text",
        PROFILE_CARD_BADGE_TEXT,
    ]

    if avatar_path:
        command.extend(["--avatar", avatar_path])

    if verified or str(verified_type or "").lower() in {"blue", "business", "government"}:
        command.extend(["--verified", "true"])

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parent,
        check=False,
    )
    if result.returncode != 0:
        error_message = (result.stderr or result.stdout or "").strip() or "Unknown renderer failure."
        raise RuntimeError(error_message)


def _avatar_suffix(content_type: str | None) -> str:
    content = (content_type or "").lower()
    if "png" in content:
        return ".png"
    if "webp" in content:
        return ".webp"
    if "gif" in content:
        return ".gif"
    return ".jpg"


def get_profile_avatar_path(discord_id: str) -> str | None:
    _ensure_cache_dirs()
    matches = _avatar_glob(discord_id)
    if not matches:
        return None
    return str(matches[0])


def get_profile_card_path(discord_id: str) -> str | None:
    _ensure_cache_dirs()
    card_path = _card_path(discord_id)
    return str(card_path) if card_path.exists() else None


def remove_profile_assets(discord_id: str) -> None:
    _ensure_cache_dirs()
    for path in _avatar_glob(discord_id):
        try:
            path.unlink()
        except FileNotFoundError:
            pass

    try:
        _card_path(discord_id).unlink()
    except FileNotFoundError:
        pass


def save_profile_avatar(
    discord_id: str,
    avatar_bytes: bytes | None,
    content_type: str | None = None,
) -> str | None:
    _ensure_cache_dirs()
    remove_profile_assets(discord_id)

    if not avatar_bytes:
        return None

    avatar_path = _AVATAR_DIR / f"{_sanitize_discord_id(discord_id)}{_avatar_suffix(content_type)}"
    avatar_path.write_bytes(avatar_bytes)
    return str(avatar_path)


def ensure_profile_card(
    discord_id: str,
    display_name: str,
    username: str,
    *,
    verified: bool = False,
    verified_type: str | None = None,
) -> str:
    _ensure_cache_dirs()

    if not TEMPLATE_PATH.exists():
        raise RuntimeError(f"Profile card template is missing: {TEMPLATE_PATH}")

    card_path = _card_path(discord_id)
    avatar_path = get_profile_avatar_path(discord_id)
    safe_username = (username or "").lstrip("@").strip()
    safe_display_name = (display_name or safe_username or "X User").strip()
    render_errors: list[str] = []

    try:
        _render_profile_card_with_node(
            card_path,
            safe_display_name,
            safe_username,
            avatar_path,
            verified=verified,
            verified_type=verified_type,
        )
        return str(card_path)
    except Exception as exc:
        render_errors.append(f"Node renderer failed: {exc}")

    try:
        _render_profile_card_with_pillow(card_path, safe_display_name, safe_username, avatar_path)
        return str(card_path)
    except Exception as exc:
        render_errors.append(f"Pillow fallback failed: {exc}")

    raise RuntimeError("Profile card rendering failed. " + " ".join(render_errors))

    return str(card_path)


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
