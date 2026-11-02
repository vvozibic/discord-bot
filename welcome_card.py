"""Render personalized arcade welcome cards without storing member data."""

from io import BytesIO
from pathlib import Path
import unicodedata

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps


DEFAULT_TEMPLATE_PATH = Path(__file__).resolve().parent / "assets" / "mindo-welcome-arcade.png"
FONT_PATH = Path(__file__).resolve().parent / "renderer" / "fonts" / "NotoSans-Bold.ttf"
CARD_SIZE = (1280, 640)
AVATAR_BOX = (566, 182, 714, 330)
GREETING_BOX = (350, 505, 930, 561)


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size)


def _readable_name(name: str) -> str:
    font = _font(46)
    missing = font.getmask("\U0010ffff")
    missing_glyph = (missing.size, bytes(missing))
    result = []
    for character in name:
        # Mathematical/Fraktur letters often lack glyphs in the bundled font.
        # Normalize only an unsupported styled letter, leaving supported text
        # intact. The Discord caption retains the member's exact original name.
        if unicodedata.decomposition(character).startswith("<font> "):
            glyph = font.getmask(character)
            if (glyph.size, bytes(glyph)) == missing_glyph:
                character = unicodedata.normalize("NFKC", character)
        result.append(character)
    return "".join(result)


def _fit_greeting(name: str) -> tuple[str, ImageFont.FreeTypeFont]:
    text = f"Welcome, {name}"
    max_width = GREETING_BOX[2] - GREETING_BOX[0] - 4
    for size in range(46, 23, -1):
        font = _font(size)
        bounds = font.getbbox(text, stroke_width=1)
        if bounds[2] - bounds[0] <= max_width:
            return text, font

    # A Discord name is normally short; keep very wide names inside the cabinet.
    font = _font(24)
    while name:
        candidate = f"Welcome, {name.rstrip()}…"
        bounds = font.getbbox(candidate, stroke_width=1)
        if bounds[2] - bounds[0] <= max_width:
            return candidate, font
        name = name[:-1]
    return "Welcome!", font


def _fallback_avatar(name: str, size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), "#11382a")
    draw = ImageDraw.Draw(image)
    for row in range(size):
        fraction = row / max(1, size - 1)
        color = (
            round(10 + 12 * fraction),
            round(34 + 39 * fraction),
            round(26 + 20 * fraction),
        )
        draw.line((0, row, size, row), fill=color)
    parts = name.split()
    initials = "".join(part[0] for part in parts[:2]) if len(parts) > 1 else name[:2]
    initials = initials.upper() or "M"
    font = _font(54)
    bounds = draw.textbbox((0, 0), initials, font=font)
    draw.text(
        ((size - (bounds[2] - bounds[0])) / 2 - bounds[0],
         (size - (bounds[3] - bounds[1])) / 2 - bounds[1]),
        initials,
        font=font,
        fill="#c4ffe2",
    )
    return image


def _avatar(avatar_bytes: bytes | None, name: str, size: int) -> Image.Image:
    avatar = None
    if avatar_bytes:
        try:
            with BytesIO(avatar_bytes) as stream, Image.open(stream) as source:
                # First frame is intentional for animated Discord avatars.
                transposed = ImageOps.exif_transpose(source)
                avatar = ImageOps.fit(
                    transposed.convert("RGBA"),
                    (size, size),
                    method=Image.Resampling.LANCZOS,
                )
        except (OSError, ValueError, Image.DecompressionBombError):
            pass
    if avatar is None:
        avatar = _fallback_avatar(name, size)

    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, mask.width - 1, mask.height - 1), fill=255)
    mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    avatar.putalpha(ImageChops.multiply(avatar.getchannel("A"), mask))
    return avatar


def render_welcome_card(
    display_name: str,
    avatar_bytes: bytes | None,
    *,
    template_path: Path = DEFAULT_TEMPLATE_PATH,
) -> bytes:
    """Return a PNG with the member's circular avatar and fitted display name.

    The bundled artwork provides the cabinet, neon ring and general-chat line.
    Missing or unreadable avatar data uses initials; template/font errors remain
    visible to the caller so it can log and retry a failed welcome.
    """
    name = _readable_name(" ".join((display_name or "").split())[:256] or "New member")
    with Image.open(template_path) as template:
        card = template.convert("RGBA").resize(CARD_SIZE, Image.Resampling.LANCZOS)

    size = AVATAR_BOX[2] - AVATAR_BOX[0]
    avatar = _avatar(avatar_bytes, name, size)
    card.alpha_composite(avatar, dest=AVATAR_BOX[:2])

    greeting, font = _fit_greeting(name)
    draw = ImageDraw.Draw(card)
    bounds = draw.textbbox((0, 0), greeting, font=font, stroke_width=1)
    x = (GREETING_BOX[0] + GREETING_BOX[2] - (bounds[2] - bounds[0])) / 2 - bounds[0]
    y = (GREETING_BOX[1] + GREETING_BOX[3] - (bounds[3] - bounds[1])) / 2 - bounds[1]
    draw.text((x, y), greeting, font=font, fill="#f4fff8", stroke_width=1, stroke_fill="#06130c")

    with BytesIO() as output:
        card.convert("RGB").save(output, format="PNG")
        return output.getvalue()
