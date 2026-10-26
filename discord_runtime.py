"""Optional Discord message-content access for the existing bot."""

import os
from collections.abc import Mapping

import discord


MESSAGE_CONTENT_UNAVAILABLE = (
    "This feature is temporarily unavailable because message-content access is "
    "disabled for this bot. Please contact an administrator. No proof check, "
    "content export, or audit was performed."
)


def build_bot_intents(env: Mapping[str, str] | None = None) -> discord.Intents:
    """Start slash commands without privileged access unless explicitly enabled."""
    env = os.environ if env is None else env
    value = env.get("DISCORD_MESSAGE_CONTENT_INTENT", "false").strip().lower()
    if value not in {"", "false", "0", "true", "1"}:
        raise ValueError("DISCORD_MESSAGE_CONTENT_INTENT must be true or false")

    intents = discord.Intents.default()
    intents.guilds = True
    intents.message_content = value in {"true", "1"}
    return intents


async def require_message_content(interaction, intents: discord.Intents) -> bool:
    """Stop content-dependent operations before restricted data looks empty."""
    if intents.message_content:
        return True
    send = (
        interaction.followup.send
        if interaction.response.is_done()
        else interaction.response.send_message
    )
    await send(
        MESSAGE_CONTENT_UNAVAILABLE,
        ephemeral=True,
        allowed_mentions=discord.AllowedMentions.none(),
    )
    return False
