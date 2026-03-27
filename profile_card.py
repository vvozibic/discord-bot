import os
import subprocess
import tempfile
from pathlib import Path

import discord


CARD_ATTACHMENT_NAME = "linked-profile-card.png"
PROFILE_CARD_CACHE_DIR = Path(
    os.getenv("PROFILE_CARD_CACHE_DIR", Path(tempfile.gettempdir()) / "mindo_profile_card_cache")
)
PROFILE_CARD_BADGE_TEXT = os.getenv("PROFILE_CARD_BADGE_TEXT", "Mindo Early Believer")
NODE_BIN = os.getenv("NODE_BIN", "node")
RENDERER_SCRIPT = Path(__file__).resolve().parent / "renderer" / "render-profile-card.mjs"
TEMPLATE_PATH = Path(__file__).resolve().parent / "renderer" / "templates" / "mindoshare-social-card.svg"

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
    if not RENDERER_SCRIPT.exists():
        raise RuntimeError(f"Profile card renderer is missing: {RENDERER_SCRIPT}")

    card_path = _card_path(discord_id)
    avatar_path = get_profile_avatar_path(discord_id)
    safe_username = (username or "").lstrip("@").strip()
    safe_display_name = (display_name or safe_username or "X User").strip()

    command = [
        NODE_BIN,
        str(RENDERER_SCRIPT),
        "--template",
        str(TEMPLATE_PATH),
        "--output",
        str(card_path),
        "--display-name",
        safe_display_name,
        "--username",
        safe_username,
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
        error_message = (result.stderr or result.stdout or "").strip()
        if not error_message:
            error_message = "Unknown renderer failure."
        raise RuntimeError(
            "Node card renderer failed. "
            "Run `npm install` in the project root and verify Node is available. "
            f"Details: {error_message}"
        )

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
