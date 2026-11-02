"""Publish the support banner with this bot; Ticket Tool owns ticket creation."""

import asyncio
from contextlib import closing
import logging
import os
from pathlib import Path
import re

import discord
from discord import app_commands


logger = logging.getLogger(__name__)
BANNER_NAME = "mindo-support-banner.png"
BANNER_PATH = Path(__file__).with_name("assets") / BANNER_NAME
DESCRIPTION = "Need help? Click **Create ticket** below to contact the Mindo AI team."


class SupportPanel:
    def __init__(self, *, guild_id=1400787114333044887,
                 channel_id=1400849374732615762,
                 ticket_tool_id=557628352828014614, banner_path=BANNER_PATH):
        self.guild_id = guild_id
        self.channel_id = channel_id
        self.ticket_tool_id = ticket_tool_id
        self.banner_path = Path(banner_path)
        self._lock = asyncio.Lock()

    @classmethod
    def from_env(cls):
        def identifier(name, default):
            value = os.environ.get(name, str(default)).strip()
            if not re.fullmatch(r"[0-9]{15,22}", value):
                raise ValueError(f"Invalid {name}")
            return int(value)

        return cls(
            guild_id=identifier("SUPPORT_GUILD_ID", 1400787114333044887),
            channel_id=identifier("SUPPORT_CHANNEL_ID", 1400849374732615762),
            ticket_tool_id=identifier("SUPPORT_TICKET_TOOL_ID", 557628352828014614),
        )

    async def _reply(self, interaction, text):
        send = (interaction.followup.send if interaction.response.is_done()
                else interaction.response.send_message)
        await send(text, ephemeral=True, allowed_mentions=discord.AllowedMentions.none())

    async def _authorize(self, interaction):
        if (interaction.guild is None or interaction.guild_id != self.guild_id
                or not interaction.permissions.administrator):
            await self._reply(interaction, "Only a server administrator can manage this support panel.")
            return False
        await interaction.response.defer(ephemeral=True, thinking=True)
        return True

    async def _channel(self, guild):
        channel = guild.get_channel(self.channel_id)
        if channel is None:
            channel = await guild.fetch_channel(self.channel_id)
        if (not isinstance(channel, discord.TextChannel) or channel.guild.id != self.guild_id
                or channel.id != self.channel_id):
            raise ValueError("The support destination must be a text channel in this server.")
        return channel

    @staticmethod
    def _is_card(message, bot_id):
        if message.author.id != bot_id or message.webhook_id is not None:
            return False
        return any(
            embed.title == "Support"
            and str(embed.image.url or "").split("?", 1)[0].rsplit("/", 1)[-1] == BANNER_NAME
            for embed in message.embeds
        )

    def _is_ticket_panel(self, message):
        # Message Content Intent can hide embeds/components. Verify ownership,
        # never copy its custom_id or replace its content or components.
        return (message.author.bot and message.author.id == self.ticket_tool_id
                and message.webhook_id is None
                and message.type is discord.MessageType.default)

    async def publish(self, interaction):
        if not await self._authorize(interaction):
            return
        try:
            async with self._lock:
                channel = await self._channel(interaction.guild)
                permissions = channel.permissions_for(interaction.guild.me)
                required = ("view_channel", "send_messages", "embed_links", "attach_files",
                            "read_message_history", "manage_messages")
                missing = [name.replace("_", " ") for name in required
                           if not getattr(permissions, name)]
                if missing:
                    raise ValueError("Give this bot these channel permissions: " + ", ".join(missing) + ".")
                # Find this bot's card across restarts without a new database or
                # relying on the separate test bot's message ID or credentials.
                existing = None
                async for message in channel.history(limit=None):
                    if self._is_card(message, interaction.client.user.id):
                        existing = message
                        break
                embed = discord.Embed(title="Support", description=DESCRIPTION, colour=0x00FF99)
                embed.set_image(url=f"attachment://{BANNER_NAME}")
                with closing(discord.File(self.banner_path, filename=BANNER_NAME)) as banner:
                    if existing is None:
                        card = await channel.send(embed=embed, file=banner,
                                                  allowed_mentions=discord.AllowedMentions.none())
                    else:
                        card = await existing.edit(embed=embed, attachments=[banner],
                                                   allowed_mentions=discord.AllowedMentions.none())
            await self._reply(
                interaction,
                f"Support panel ready: {card.jump_url}\n"
                "If the Ticket Tool button is not already directly below this banner, "
                f"send its existing Support panel to <#{self.channel_id}> from the Ticket Tool dashboard. "
                "This bot will hide its default embed and keep the original Create ticket button.",
            )
        except (discord.HTTPException, OSError, ValueError) as error:
            logger.warning("Support publish failed: %s", type(error).__name__)
            detail = str(error) if isinstance(error, ValueError) else (
                "Check this bot's channel permissions and the bundled support banner, then retry.")
            await self._reply(interaction, f"Support panel was not published. {detail}")

    async def set_ticket_panel(self, interaction, message_id, *, suppressed):
        if not await self._authorize(interaction):
            return
        try:
            if not re.fullmatch(r"[0-9]{15,22}", message_id):
                raise ValueError("Enter the Ticket Tool message ID from the support channel.")
            async with self._lock:
                channel = await self._channel(interaction.guild)
                message = await channel.fetch_message(int(message_id))
                if not self._is_ticket_panel(message):
                    raise ValueError("That message is not an original Ticket Tool panel.")
                await message.edit(suppress=suppressed)
            await self._reply(interaction, "Ticket Tool embed hidden; its original button is preserved."
                              if suppressed else "Ticket Tool embed restored.")
        except (discord.HTTPException, ValueError) as error:
            logger.warning("Support panel toggle failed: %s", type(error).__name__)
            detail = str(error) if isinstance(error, ValueError) else (
                "Check the message ID and this bot's Manage Messages permission.")
            await self._reply(interaction, f"Ticket Tool panel was not changed. {detail}")

    async def handle_message(self, message):
        if (message.guild is None or message.guild.id != self.guild_id
                or message.channel.id != self.channel_id or not self._is_ticket_panel(message)):
            return False
        try:
            async with self._lock:
                # Suppress only an authentic panel immediately below our card,
                # including after a restart. Older panels remain untouched.
                async for previous in message.channel.history(limit=1, before=message):
                    if self._is_card(previous, message.guild.me.id):
                        if not message.flags.suppress_embeds:
                            await message.edit(suppress=True)
                        return True
            return False
        except discord.HTTPException:
            logger.warning("Could not hide Ticket Tool embed in support channel %s", self.channel_id)
            return False


def register_support_commands(tree, panel):
    @app_commands.command(name="support-panel", description="Publish or update the Mindo support banner")
    @app_commands.guild_only()
    @app_commands.default_permissions(administrator=True)
    async def support_panel(interaction: discord.Interaction):
        await panel.publish(interaction)

    @app_commands.command(name="support-hide", description="Hide a Ticket Tool embed, keeping its original button")
    @app_commands.guild_only()
    @app_commands.default_permissions(administrator=True)
    @app_commands.describe(message_id="Ticket Tool message ID in the configured support channel")
    async def support_hide(interaction: discord.Interaction, message_id: str):
        await panel.set_ticket_panel(interaction, message_id, suppressed=True)

    @app_commands.command(name="support-restore", description="Restore an original Ticket Tool embed")
    @app_commands.guild_only()
    @app_commands.default_permissions(administrator=True)
    @app_commands.describe(message_id="Ticket Tool message ID in the configured support channel")
    async def support_restore(interaction: discord.Interaction, message_id: str):
        await panel.set_ticket_panel(interaction, message_id, suppressed=False)

    for command in (support_panel, support_hide, support_restore):
        tree.add_command(command)
