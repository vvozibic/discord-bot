"""Relay Discord's system join messages to the Mindo welcome channel."""

import asyncio
import logging
from collections import OrderedDict
from contextlib import closing
from pathlib import Path

import discord


logger = logging.getLogger(__name__)
WELCOME_IMAGE_NAME = "mindo-welcome.png"
DEFAULT_IMAGE_PATH = Path(__file__).resolve().parent / "assets" / WELCOME_IMAGE_NAME


def build_welcome_layout(member: discord.Member | discord.User) -> discord.ui.LayoutView:
    """Keep the mention, current display avatar, and banner in one message."""
    view = discord.ui.LayoutView(timeout=None)
    view.add_item(
        discord.ui.Section(
            discord.ui.TextDisplay(f"Hey , <@{member.id}>, welcome to Mindo AI"),
            accessory=discord.ui.Thumbnail(
                member.display_avatar.with_size(256).url,
                description="New member's Discord avatar",
            ),
        )
    )
    view.add_item(
        discord.ui.MediaGallery(
            discord.MediaGalleryItem(
                f"attachment://{WELCOME_IMAGE_NAME}",
                description="Mindo Poker welcome banner",
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

                with closing(discord.File(self.image_path, filename=WELCOME_IMAGE_NAME)) as banner:
                    await target.send(
                        view=build_welcome_layout(message.author),
                        file=banner,
                        allowed_mentions=discord.AllowedMentions(
                            users=[message.author],
                            roles=False,
                            everyone=False,
                            replied_user=False,
                        ),
                    )
            except (discord.HTTPException, OSError):
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
