"""Forest Trail launch command for the existing Mindo bot."""

from dataclasses import dataclass
import os
import re
from collections.abc import Mapping

import discord
from discord import app_commands


DEFAULT_ACTIVITY_ID = 1556624227212460092
DEFAULT_GUILD_ID = 1400787114333044887
DEFAULT_TEST_CHANNEL_ID = 1421187164187791381
_SNOWFLAKE = re.compile(r"[0-9]{15,22}\Z")


@dataclass(frozen=True)
class GameSettings:
    activity_id: int = DEFAULT_ACTIVITY_ID
    guild_id: int = DEFAULT_GUILD_ID
    test_channel_id: int = DEFAULT_TEST_CHANNEL_ID
    enabled: bool = True

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None):
        env = os.environ if env is None else env

        def identifier(name, default):
            value = env.get(name, str(default)).strip()
            if not _SNOWFLAKE.fullmatch(value) or int(value) <= 0:
                raise ValueError(f"Invalid {name}")
            return int(value)

        enabled = env.get("FOREST_TRAIL_ENABLED", "true").strip().lower()
        if enabled not in {"true", "false", "1", "0"}:
            raise ValueError("Invalid FOREST_TRAIL_ENABLED")
        return cls(
            activity_id=identifier("FOREST_TRAIL_ACTIVITY_ID", DEFAULT_ACTIVITY_ID),
            guild_id=identifier("FOREST_TRAIL_GUILD_ID", DEFAULT_GUILD_ID),
            test_channel_id=identifier("FOREST_TRAIL_TEST_CHANNEL_ID", DEFAULT_TEST_CHANNEL_ID),
            enabled=enabled in {"true", "1"},
        )

    @property
    def activity_url(self):
        return f"https://discord.com/activities/{self.activity_id}"


async def _private_reply(interaction, content, **kwargs):
    send = interaction.followup.send if interaction.response.is_done() else interaction.response.send_message
    await send(content, ephemeral=True, allowed_mentions=discord.AllowedMentions.none(), **kwargs)


async def launch_forest_trail(interaction: discord.Interaction, settings: GameSettings | None = None):
    try:
        settings = settings or GameSettings.from_env()
    except ValueError:
        await _private_reply(interaction, "The mini-game configuration needs attention. Please contact an administrator.")
        return

    if (interaction.guild_id != settings.guild_id
            or interaction.channel_id != settings.test_channel_id
            or not interaction.permissions.administrator):
        await _private_reply(interaction, "Forest Trail is being tested by administrators in #admin-only.")
        return
    if not settings.enabled:
        await _private_reply(interaction, "Forest Trail is temporarily disabled.")
        return

    # Callback 12 opens the responding app's own Activity. A bot command cannot
    # use it to launch a different application, so reuse that Activity's link.
    if interaction.application_id == settings.activity_id:
        try:
            await interaction.response.launch_activity()
        except discord.HTTPException:
            await _private_reply(interaction, "Discord could not launch Forest Trail. Please try again shortly.")
        return

    view = discord.ui.View(timeout=None)
    view.add_item(discord.ui.Button(label="Play Forest Trail", style=discord.ButtonStyle.link, url=settings.activity_url))
    embed = discord.Embed(
        title="Forest Trail",
        description="Collect six coins in order and reach the portal.\nConnect your Discord profile in the game to save verified results.",
        colour=0x00FF99,
    )
    await _private_reply(interaction, "Open the mini-game with the button below.", embed=embed, view=view)


def register_game_command(tree: app_commands.CommandTree):
    @app_commands.command(name="play", description="Play the Forest Trail mini-game")
    @app_commands.guild_only()
    @app_commands.default_permissions(administrator=True)
    async def play(interaction: discord.Interaction):
        await launch_forest_trail(interaction)

    tree.add_command(play)
    return play
