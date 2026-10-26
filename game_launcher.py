"""Forest Trail launch command for the existing Mindo bot."""

from dataclasses import dataclass
import os
import re
from collections.abc import Mapping

import discord
from discord import app_commands


DEFAULT_GUILD_ID = 1400787114333044887
DEFAULT_TEST_CHANNEL_ID = 1421187164187791381
DEFAULT_BETA_CHANNEL_ID = 1564277364089823285
DEFAULT_BETA_ROLE_ID = 1564276225520963726
_SNOWFLAKE = re.compile(r"[0-9]{15,22}\Z")


@dataclass(frozen=True)
class GameSettings:
    activity_id: int | None = None
    guild_id: int = DEFAULT_GUILD_ID
    test_channel_id: int = DEFAULT_TEST_CHANNEL_ID
    beta_channel_id: int = DEFAULT_BETA_CHANNEL_ID
    beta_role_id: int = DEFAULT_BETA_ROLE_ID
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
            activity_id=(identifier("FOREST_TRAIL_ACTIVITY_ID", "")
                         if env.get("FOREST_TRAIL_ACTIVITY_ID", "").strip() else None),
            guild_id=identifier("FOREST_TRAIL_GUILD_ID", DEFAULT_GUILD_ID),
            test_channel_id=identifier("FOREST_TRAIL_TEST_CHANNEL_ID", DEFAULT_TEST_CHANNEL_ID),
            beta_channel_id=identifier("FOREST_TRAIL_BETA_CHANNEL_ID", DEFAULT_BETA_CHANNEL_ID),
            beta_role_id=identifier("FOREST_TRAIL_BETA_ROLE_ID", DEFAULT_BETA_ROLE_ID),
            enabled=enabled in {"true", "1"},
        )

async def _private_reply(interaction, content, **kwargs):
    send = interaction.followup.send if interaction.response.is_done() else interaction.response.send_message
    await send(content, ephemeral=True, allowed_mentions=discord.AllowedMentions.none(), **kwargs)


async def launch_forest_trail(interaction: discord.Interaction, settings: GameSettings | None = None):
    try:
        settings = settings or GameSettings.from_env()
    except ValueError:
        await _private_reply(interaction, "The mini-game configuration needs attention. Please contact an administrator.")
        return

    admin = interaction.permissions.administrator
    beta = interaction.channel_id == settings.beta_channel_id
    beta_member = any(role.id == settings.beta_role_id
                      for role in getattr(getattr(interaction, "user", None), "roles", ()))
    allowed_channel = ((interaction.channel_id == settings.test_channel_id and admin)
                       or (beta and (admin or beta_member)))
    if interaction.guild_id != settings.guild_id or not allowed_channel:
        await _private_reply(interaction, "Forest Trail is available to beta testers in #beta-testing and administrators in #admin-only.")
        return
    if not settings.enabled:
        await _private_reply(interaction, "Forest Trail is temporarily disabled.")
        return

    if settings.activity_id is not None and interaction.application_id != settings.activity_id:
        await _private_reply(interaction, "Enable Forest Trail as an Activity of this bot's application. An administrator must check the Activity configuration.")
        return
    # Callback 12 launches this bot's own Activity inside Discord. No website
    # or other application's launcher is used.
    try:
        await interaction.response.launch_activity()
    except discord.HTTPException:
        await _private_reply(interaction, "Discord could not launch Forest Trail. Please try again shortly.")


class ForestTrailView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Play Forest Trail", style=discord.ButtonStyle.success,
                       custom_id="forest-trail:play")
    async def play(self, interaction: discord.Interaction, button: discord.ui.Button):
        await launch_forest_trail(interaction)


async def publish_game_panel(interaction: discord.Interaction, settings: GameSettings | None = None):
    try:
        settings = settings or GameSettings.from_env()
    except ValueError:
        await _private_reply(interaction, "The mini-game configuration needs attention. Please contact an administrator.")
        return
    if (interaction.guild_id != settings.guild_id
            or interaction.channel_id not in {settings.test_channel_id, settings.beta_channel_id}
            or not interaction.permissions.administrator):
        await _private_reply(interaction, "An administrator must publish the game panel in #beta-testing or #admin-only.")
        return
    if not settings.enabled:
        await _private_reply(interaction, "Forest Trail is temporarily disabled.")
        return
    await interaction.response.send_message(
        embed=discord.Embed(title="Forest Trail", colour=0x00FF99,
                            description="Collect six coins in order and reach the portal.\nPlay inside Discord. Your verified results are saved to your Discord profile."),
        view=ForestTrailView(), ephemeral=False, allowed_mentions=discord.AllowedMentions.none())


def register_game_command(tree: app_commands.CommandTree):
    @app_commands.command(name="play", description="Play the Forest Trail mini-game")
    @app_commands.guild_only()
    async def play(interaction: discord.Interaction):
        await launch_forest_trail(interaction)

    tree.add_command(play)

    @app_commands.command(name="game-panel", description="Publish the Forest Trail game panel")
    @app_commands.guild_only()
    @app_commands.default_permissions(administrator=True)
    async def game_panel(interaction: discord.Interaction):
        await publish_game_panel(interaction)

    tree.add_command(game_panel)
    return play
