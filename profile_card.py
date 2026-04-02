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
TEMPLATE_DIR = Path(__file__).resolve().parent / "renderer" / "templates"
TEMPLATE_PATH = TEMPLATE_DIR / "mindoshare-social-card.jpg"
PROFILE_CARD_TIER_TEMPLATE_PATHS = {
    "bronze": TEMPLATE_DIR / "mindoshare-social-card-bronze.png",
    "silver": TEMPLATE_DIR / "mindoshare-social-card-silver.png",
    "gold": TEMPLATE_DIR / "mindoshare-social-card-gold.png",
}
PROFILE_CARD_FONT_DIR = Path(
    os.getenv("PROFILE_CARD_FONT_DIR", Path(__file__).resolve().parent / "renderer" / "fonts")
)
BASE_TEMPLATE_WIDTH = 850
BASE_TEMPLATE_HEIGHT = 1536
TEXT_SCALE_MULTIPLIER = 1
TIER_TEMPLATE_WIDTH = 853
TIER_TEMPLATE_HEIGHT = 1280
TIER_AVATAR_RING_SIZE = 389
TIER_AVATAR_SIZE = 354
TIER_AVATAR_RING_TOP = 218
TIER_TEXT_SAFE_TOP = 96
TIER_TEXT_TO_CIRCLE_GAP = 24
TIER_TEXT_SIZE = 64
TIER_TEXT_MIN_SIZE = 40
TIER_TEXT_LINE_GAP = 18
TIER_TEXT_MAX_WIDTH = 620

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
    bundled_fonts = [
        PROFILE_CARD_FONT_DIR / ("Onest-Bold.ttf" if bold else "Onest-Regular.ttf"),
        PROFILE_CARD_FONT_DIR / ("NotoSans-Bold.ttf" if bold else "NotoSans-Regular.ttf"),
    ]
    windows_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    linux_fonts = [
        Path("/usr/share/fonts/truetype/noto") / ("NotoSans-Bold.ttf" if bold else "NotoSans-Regular.ttf"),
        Path("/usr/share/fonts/opentype/noto") / ("NotoSans-Bold.ttf" if bold else "NotoSans-Regular.ttf"),
        Path("/usr/share/fonts/truetype/dejavu") / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation2")
        / ("LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf"),
    ]
    mac_fonts = [
        Path("/System/Library/Fonts/Supplemental") / ("Arial Bold.ttf" if bold else "Arial.ttf"),
        Path("/Library/Fonts") / ("Arial Bold.ttf" if bold else "Arial.ttf"),
    ]
    font_candidates = [
        *bundled_fonts,
        windows_fonts / ("segoeuib.ttf" if bold else "segoeui.ttf"),
        windows_fonts / ("arialbd.ttf" if bold else "arial.ttf"),
        windows_fonts / ("calibrib.ttf" if bold else "calibri.ttf"),
        *linux_fonts,
        *mac_fonts,
    ]

    for font_name in font_candidates:
        try:
            if Path(font_name).exists():
                return ImageFont.truetype(str(font_name), size)
        except OSError:
            continue

    checked_paths = ", ".join(str(path) for path in font_candidates[:6])
    raise RuntimeError(
        "No scalable font available for profile card rendering. "
        f"Checked: {checked_paths}"
    )


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


def _measure_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


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


def _resolve_template_path(card_tier: str | None = None) -> Path:
    normalized_tier = (card_tier or "").strip().lower()
    tier_template = PROFILE_CARD_TIER_TEMPLATE_PATHS.get(normalized_tier)
    if tier_template and tier_template.exists():
        return tier_template
    return TEMPLATE_PATH


def _uses_tier_theme_layout(template_path: Path) -> bool:
    normalized_name = template_path.name.lower()
    return any(path.name.lower() == normalized_name for path in PROFILE_CARD_TIER_TEMPLATE_PATHS.values())


def _render_profile_card_with_pillow(
    card_path: Path,
    template_path: Path,
    display_name: str,
    username: str,
    avatar_path: str | None,
) -> None:
    with Image.open(template_path) as source:
        canvas = source.convert("RGBA")

    width, height = canvas.size
    center_x = width / 2
    scale_x = width / BASE_TEMPLATE_WIDTH
    scale_y = height / BASE_TEMPLATE_HEIGHT
    scale = min(scale_x, scale_y)
    use_tier_theme_layout = _uses_tier_theme_layout(template_path)

    if use_tier_theme_layout:
        tier_scale_x = width / TIER_TEMPLATE_WIDTH
        tier_scale_y = height / TIER_TEMPLATE_HEIGHT
        tier_scale = min(tier_scale_x, tier_scale_y)
        avatar_ring_size = round(TIER_AVATAR_RING_SIZE * tier_scale)
        avatar_size = round(TIER_AVATAR_SIZE * tier_scale)
        avatar_ring_top = round(TIER_AVATAR_RING_TOP * tier_scale_y)
        avatar_y = round(avatar_ring_top + (avatar_ring_size - avatar_size) / 2)
    else:
        avatar_size = max(132, round(220 * scale))
        avatar_y = round(228 * scale_y)
    avatar_x = round(center_x - avatar_size / 2)

    if not use_tier_theme_layout:
        shadow = Image.new("RGBA", (avatar_size + 48, avatar_size + 48), (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow)
        shadow_draw.ellipse((20, 18, avatar_size + 20, avatar_size + 18), fill=(6, 34, 18, 148))
        shadow = shadow.filter(ImageFilter.GaussianBlur(radius=max(8, round(16 * scale))))
        canvas.alpha_composite(shadow, (avatar_x - 24, avatar_y - 8))

    avatar = _build_avatar_image(avatar_path, display_name, username, avatar_size)

    draw = ImageDraw.Draw(canvas)
    if use_tier_theme_layout:
        name_max_width = round(TIER_TEXT_MAX_WIDTH * tier_scale_x)
        handle_max_width = round(TIER_TEXT_MAX_WIDTH * tier_scale_x)
        name_start_size = max(40, round(TIER_TEXT_SIZE * tier_scale))
        handle_start_size = max(40, round(TIER_TEXT_SIZE * tier_scale))
        name_min_size = max(28, round(TIER_TEXT_MIN_SIZE * tier_scale))
        handle_min_size = max(28, round(TIER_TEXT_MIN_SIZE * tier_scale))
        text_line_gap = max(10, round(TIER_TEXT_LINE_GAP * tier_scale_y))
        content_top = round(TIER_TEXT_SAFE_TOP * tier_scale_y)
        content_bottom = avatar_ring_top - round(TIER_TEXT_TO_CIRCLE_GAP * tier_scale_y)
        available_height = max(0, content_bottom - content_top)
    else:
        name_max_width = width - round(120 * scale_x)
        handle_max_width = width - round(130 * scale_x)
        name_start_size = max(40, round(68 * scale * TEXT_SCALE_MULTIPLIER))
        handle_start_size = max(28, round(50 * scale * TEXT_SCALE_MULTIPLIER))
        name_min_size = max(28, round(34 * scale))
        handle_min_size = max(22, round(30 * scale))
        content_top = avatar_y + avatar_size + max(24, round(54 * scale_y))
        content_bottom = round(820 * scale_y) - max(20, round(44 * scale_y))
        text_line_gap = max(12, round(24 * scale_y))
        available_height = max(0, content_bottom - content_top)

    fitted_name, name_font = _fit_text(
        draw,
        display_name or username or "X User",
        name_max_width,
        size=name_start_size,
        min_size=name_min_size,
        bold=True,
    )

    _, name_height = _measure_text(draw, fitted_name, name_font)
    if use_tier_theme_layout:
        handle_text = ""
        fitted_handle = ""
        handle_font = None
        handle_height = 0
    else:
        handle_text = f"@{(username or '').lstrip('@')}"
        fitted_handle, handle_font = _fit_text(
            draw,
            handle_text,
            handle_max_width,
            size=handle_start_size,
            min_size=handle_min_size,
            bold=False,
        )
        _, handle_height = _measure_text(draw, fitted_handle, handle_font)

    while (
        name_height + text_line_gap + handle_height > available_height
        and (name_start_size > name_min_size or handle_start_size > handle_min_size)
    ):
        if name_start_size > name_min_size:
            name_start_size -= 2
        if not use_tier_theme_layout and handle_start_size > handle_min_size:
            handle_start_size -= 2

        fitted_name, name_font = _fit_text(
            draw,
            display_name or username or "X User",
            name_max_width,
            size=name_start_size,
            min_size=name_min_size,
            bold=True,
        )
        _, name_height = _measure_text(draw, fitted_name, name_font)
        if not use_tier_theme_layout:
            fitted_handle, handle_font = _fit_text(
                draw,
                handle_text,
                handle_max_width,
                size=handle_start_size,
                min_size=handle_min_size,
                bold=False,
            )
            _, handle_height = _measure_text(draw, fitted_handle, handle_font)

    text_block_height = name_height if use_tier_theme_layout else name_height + text_line_gap + handle_height
    if use_tier_theme_layout:
        text_top = max(content_top, content_bottom - text_block_height)
    else:
        text_top = round(content_top + max(0, available_height - text_block_height) / 2)

    canvas.alpha_composite(avatar, (avatar_x, avatar_y))

    _draw_centered_text(
        draw,
        fitted_name,
        center_x,
        text_top,
        font=name_font,
        fill="#ffffff" if use_tier_theme_layout else "#f8fafc",
    )

    if not use_tier_theme_layout and handle_font:
        _draw_centered_text(
            draw,
            fitted_handle,
            center_x,
            text_top + name_height + text_line_gap,
            font=handle_font,
            fill="#f4f4f5",
        )

    canvas.convert("RGB").save(card_path, format="PNG", optimize=True)


def _render_profile_card_with_node(
    card_path: Path,
    template_path: Path,
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
        str(template_path),
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

    if not avatar_bytes:
        return get_profile_avatar_path(discord_id)

    try:
        _card_path(discord_id).unlink()
    except FileNotFoundError:
        pass

    for path in _avatar_glob(discord_id):
        try:
            path.unlink()
        except FileNotFoundError:
            pass

    avatar_path = _AVATAR_DIR / f"{_sanitize_discord_id(discord_id)}{_avatar_suffix(content_type)}"
    avatar_path.write_bytes(avatar_bytes)
    return str(avatar_path)


def ensure_profile_card(
    discord_id: str,
    display_name: str,
    username: str,
    *,
    card_tier: str | None = None,
    verified: bool = False,
    verified_type: str | None = None,
) -> str:
    _ensure_cache_dirs()

    template_path = _resolve_template_path(card_tier)
    if not template_path.exists():
        raise RuntimeError(f"Profile card template is missing: {template_path}")

    card_path = _card_path(discord_id)
    avatar_path = get_profile_avatar_path(discord_id)
    safe_username = (username or "").lstrip("@").strip()
    safe_display_name = (display_name or safe_username or "X User").strip()
    render_errors: list[str] = []

    try:
        _render_profile_card_with_node(
            card_path,
            template_path,
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
        _render_profile_card_with_pillow(card_path, template_path, safe_display_name, safe_username, avatar_path)
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
