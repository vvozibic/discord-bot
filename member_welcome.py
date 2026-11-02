"""Relay Discord's system join messages to the Mindo welcome channel."""

import asyncio
import logging
from collections import OrderedDict
from contextlib import closing
from io import BytesIO
from pathlib import Path

import aiohttp
import discord

from welcome_card import DEFAULT_TEMPLATE_PATH, render_welcome_card


logger = logging.getLogger(__name__)
WELCOME_IMAGE_NAME = "mindo-welcome.png"
DEFAULT_IMAGE_PATH = DEFAULT_TEMPLATE_PATH
AVATAR_DOWNLOAD_TIMEOUT = 10


def build_welcome_layout(
    member: discord.Member | discord.User,
    *,
    introductions_channel_id: int | None = None,
) -> discord.ui.LayoutView:
    """Show the display name without relying on Discord's mention resolution."""
    name = discord.utils.escape_mentions(
        discord.utils.escape_markdown(member.display_name)
    )
    view = discord.ui.LayoutView(timeout=None)
    next_stop = (
        f"<#{introductions_channel_id}>"
        if introductions_channel_id is not None
        else "#introductions"
    )
    view.add_item(
        discord.ui.TextDisplay(
            f"Hey, **{name}**, welcome to Mindo AI\nNext stop: {next_stop}"
        )
    )
    view.add_item(
        discord.ui.MediaGallery(
            discord.MediaGalleryItem(
                f"attachment://{WELCOME_IMAGE_NAME}",
                description="Personalized Mindo AI arcade welcome card",
            )
        )
    )
    return view


class MemberWelcomeRelay:
    def __init__(
        self,
        *,
        source_channel_id: int,
        target_channel_id: int,
        image_path: Path = DEFAULT_IMAGE_PATH,
    ) -> None:
        self.source_channel_id = source_channel_id
        self.target_channel_id = target_channel_id
        self.image_path = Path(image_path)
        self._send_lock = asyncio.Lock()
        # Bound memory while ignoring repeated gateway events in this process.
        # A rejoin has a new message ID and receives a new welcome.
        self._sent_message_ids: OrderedDict[int, None] = OrderedDict()

    async def handle_message(self, message: discord.Message) -> bool:
        if (
            not self.source_channel_id
            or not self.target_channel_id
            or message.guild is None
            or message.channel.id != self.source_channel_id
            or message.type is not discord.MessageType.new_member
            or message.author.bot
        ):
            return False

        async with self._send_lock:
            if message.id in self._sent_message_ids:
                return False

            try:
                target = message.guild.get_channel(self.target_channel_id)
                if target is None:
                    target = await message.guild.fetch_channel(self.target_channel_id)
                if (
                    not isinstance(target, discord.TextChannel)
                    or target.guild.id != message.guild.id
                ):
                    logger.error(
                        "Welcome target %s must be a text channel in guild %s",
                        self.target_channel_id,
                        message.guild.id,
                    )
                    return False

                try:
                    avatar = message.author.display_avatar.with_size(256).with_format("png")
                    avatar_bytes = await asyncio.wait_for(
                        avatar.read(), timeout=AVATAR_DOWNLOAD_TIMEOUT
                    )
                except (discord.HTTPException, aiohttp.ClientError, TimeoutError):
                    logger.warning(
                        "Could not download welcome avatar for member %s; using initials",
                        message.author.id,
                    )
                    avatar_bytes = None

                card_bytes = await asyncio.to_thread(
                    render_welcome_card,
                    message.author.display_name,
                    avatar_bytes,
                    template_path=self.image_path,
                )
                introductions = discord.utils.get(
                    message.guild.text_channels, name="introductions"
                )
                with BytesIO(card_bytes) as card_buffer, closing(
                    discord.File(card_buffer, filename=WELCOME_IMAGE_NAME)
                ) as banner:
                    await target.send(
                        view=build_welcome_layout(
                            message.author,
                            introductions_channel_id=(
                                introductions.id if introductions is not None else None
                            ),
                        ),
                        file=banner,
                        allowed_mentions=discord.AllowedMentions.none(),
                    )
            except (discord.HTTPException, OSError, ValueError):
                logger.exception(
                    "Could not send welcome for join message %s to channel %s",
                    message.id,
                    self.target_channel_id,
                )
                return False

            self._sent_message_ids[message.id] = None
            if len(self._sent_message_ids) > 4096:
                self._sent_message_ids.popitem(last=False)
            return True
