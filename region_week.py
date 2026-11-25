"""Region Week launch card: one slash command posts it, flag reactions hand out one region role."""

import asyncio
from collections import OrderedDict
from contextlib import closing
import logging
import os
from pathlib import Path
import re

import discord
from discord import app_commands


logger = logging.getLogger(__name__)
ASSETS = Path(__file__).with_name("assets")
BANNER_NAME = "region-week-launch.png"
BANNER_PATH = ASSETS / BANNER_NAME
TEXT_PATH = ASSETS / "region-week-launch.md"
COLOUR = 0x00FF99  # the same green as the support banner and this bot's avatar
# Flag reaction -> region role in Mindo AI (created 2026-11-24), in the order the reactions are added.
FLAG_ROLES = (
    ("\U0001F1E7\U0001F1E9", 1574771182295584819),  # Bangladesh
    ("\U0001F1EE\U0001F1F3", 1574770252187701288),  # India
    ("\U0001F1EE\U0001F1E9", 1574771394888335380),  # Indonesia
    ("\U0001F1F0\U0001F1F7", 1574771580452470945),  # Korea
    ("\U0001F1F3\U0001F1EC", 1574771099558740070),  # Nigeria
    ("\U0001F1F7\U0001F1FA", 1574771140121993216),  # Russia
    ("\U0001F1F9\U0001F1F7", 1574771643971018892),  # Turkey
    ("\U0001F1FA\U0001F1E6", 1574770980142719176),  # Ukraine
    ("\U0001F1FB\U0001F1F3", 1574771059024990218),  # Vietnam
)
REQUIRED = ("view_channel", "send_messages", "embed_links", "attach_files", "add_reactions",
            "read_message_history", "manage_messages")
CARD_CACHE = 512


class RegionWeek:
    def __init__(self, *, guild_id=1400787114333044887, flag_roles=FLAG_ROLES,
                 banner_path=BANNER_PATH, text_path=TEXT_PATH):
        self.guild_id = guild_id
        self.flag_roles = dict(flag_roles)
        self.role_ids = set(self.flag_roles.values())
        self.banner_path = Path(banner_path)
        self.text_path = Path(text_path)
        self._publish_lock = asyncio.Lock()
        self._member_locks = {}
        self._cards = OrderedDict()

    @classmethod
    def from_env(cls):
        value = os.environ.get("REGION_WEEK_GUILD_ID", "1400787114333044887").strip()
        if not re.fullmatch(r"[0-9]{15,22}", value):
            raise ValueError("Invalid REGION_WEEK_GUILD_ID")
        return cls(guild_id=int(value))

    # ---------------------------------------------------------------- the card
    def build_embed(self):
        text = self.text_path.read_text(encoding="utf-8").replace("\r\n", "\n").strip()
        embed = discord.Embed(description=text, colour=COLOUR)
        embed.set_image(url=f"attachment://{BANNER_NAME}")
        return embed

    @staticmethod
    def is_card(message, bot_id):
        if message.author.id != bot_id or message.webhook_id is not None:
            return False
        return any(str(embed.image.url or "").split("?", 1)[0].rsplit("/", 1)[-1] == BANNER_NAME
                   for embed in message.embeds)

    def _remember(self, message_id, is_card):
        self._cards[message_id] = is_card
        self._cards.move_to_end(message_id)
        while len(self._cards) > CARD_CACHE:
            self._cards.popitem(last=False)

    async def _reply(self, interaction, text):
        send = (interaction.followup.send if interaction.response.is_done()
                else interaction.response.send_message)
        await send(text, ephemeral=True, allowed_mentions=discord.AllowedMentions.none())

    async def _authorize(self, interaction):
        if (interaction.guild is None or interaction.guild_id != self.guild_id
                or not interaction.permissions.administrator):
            await self._reply(interaction, "Only a server administrator can post the Region Week card.")
            return False
        await interaction.response.defer(ephemeral=True, thinking=True)
        return True

    def flag_roles_in(self, guild):
        """The nine region roles, checked so the bot can really hand them out."""
        me = guild.me
        if not me.guild_permissions.manage_roles:
            raise ValueError("Give this bot the Manage Roles permission.")
        roles = {}
        for emoji, role_id in self.flag_roles.items():
            role = guild.get_role(role_id)
            if role is None:
                raise ValueError(f"The region role for {emoji} ({role_id}) is missing in this server.")
            if role >= me.top_role:
                raise ValueError(f"Move this bot's role above {role.name} so it can hand out the flags.")
            roles[emoji] = role
        return roles

    async def publish(self, interaction, channel=None, *, ping=True, repost=False):
        if not await self._authorize(interaction):
            return
        card = None
        try:
            async with self._publish_lock:
                target = channel or interaction.channel
                if not isinstance(target, discord.TextChannel) or target.guild.id != self.guild_id:
                    raise ValueError("Pick a text channel in this server.")
                me = interaction.guild.me
                permissions = target.permissions_for(me)
                required = REQUIRED + (("mention_everyone",) if ping else ())
                missing = [name.replace("_", " ") for name in required if not getattr(permissions, name)]
                if missing:
                    raise ValueError(f"Give this bot these permissions in {target.mention}: "
                                     + ", ".join(missing) + ".")
                self.flag_roles_in(interaction.guild)
                if not repost:
                    async for message in target.history(limit=50):
                        if self.is_card(message, me.id):
                            raise ValueError(f"{target.mention} already has the Region Week card: "
                                             f"{message.jump_url}\nRun the command with repost:True to post another one.")
                embed = self.build_embed()
                mentions = (discord.AllowedMentions(everyone=True, users=False, roles=False) if ping
                            else discord.AllowedMentions.none())
                with closing(discord.File(self.banner_path, filename=BANNER_NAME)) as banner:
                    card = await target.send(content="@everyone" if ping else None, embed=embed,
                                             file=banner, allowed_mentions=mentions)
                self._remember(card.id, True)
                for emoji in self.flag_roles:
                    await card.add_reaction(emoji)
            await self._reply(interaction, f"Region Week card posted: {card.jump_url}\n"
                                           "Each flag reaction gives its region role, one flag per member.")
        except (discord.HTTPException, OSError, ValueError) as error:
            logger.warning("Region Week publish failed: %s", type(error).__name__)
            if card is not None:
                await self._reply(interaction, f"The card is posted ({card.jump_url}), but not every flag "
                                               "reaction was added. Add the missing flags by hand in the same order.")
                return
            detail = str(error) if isinstance(error, ValueError) else (
                "Check this bot's channel permissions and the bundled banner, then retry.")
            await self._reply(interaction, f"The Region Week card was not posted. {detail}")

    # ---------------------------------------------------------------- the flags
    async def _is_card_id(self, guild, channel_id, message_id, bot_id):
        known = self._cards.get(message_id)
        if known is not None:
            self._cards.move_to_end(message_id)
            return known
        try:
            channel = guild.get_channel_or_thread(channel_id) or await guild.fetch_channel(channel_id)
            message = await channel.fetch_message(message_id)
        except (discord.Forbidden, discord.NotFound, AttributeError):
            self._remember(message_id, False)  # unreadable or gone: it is not our card
            return False
        except discord.HTTPException:
            return False  # a passing error: ask again next time
        result = self.is_card(message, bot_id)
        self._remember(message_id, result)
        return result

    async def handle_reaction(self, client, payload, *, added):
        """Give or take the region role for a flag reaction on our card. One flag per member."""
        bot_user = client.user
        if (payload.guild_id != self.guild_id or bot_user is None or payload.user_id == bot_user.id
                or payload.emoji.id is not None or str(payload.emoji) not in self.flag_roles):
            return False
        guild = client.get_guild(payload.guild_id)
        if guild is None or not await self._is_card_id(guild, payload.channel_id, payload.message_id, bot_user.id):
            return False
        emoji = str(payload.emoji)
        lock = self._member_locks.setdefault(payload.user_id, asyncio.Lock())
        try:
            async with lock:
                member = payload.member if added else None
                if member is None:
                    member = guild.get_member(payload.user_id) or await guild.fetch_member(payload.user_id)
                if member.bot:
                    return False
                role = guild.get_role(self.flag_roles[emoji])
                if role is None:
                    logger.warning("Region Week role for %s is missing", emoji)
                    return False
                if not added:
                    if any(current.id == role.id for current in member.roles):
                        await member.remove_roles(role, reason="Region Week: flag reaction removed")
                    return True
                others = [current for current in member.roles
                          if current.id in self.role_ids and current.id != role.id]
                if not any(current.id == role.id for current in member.roles):
                    await member.add_roles(role, reason="Region Week: flag picked")
                if others:
                    await member.remove_roles(*others, reason="Region Week: one flag per member")
                    channel = guild.get_channel_or_thread(payload.channel_id)
                    card = channel.get_partial_message(payload.message_id) if channel is not None else None
                    for other in others:
                        old = next((flag for flag, role_id in self.flag_roles.items() if role_id == other.id), None)
                        if card is not None and old is not None:
                            try:
                                await card.remove_reaction(old, member)
                            except discord.HTTPException:
                                pass  # the role is what counts; a stale reaction is harmless
                return True
        except discord.NotFound:
            return False  # the member left
        except discord.HTTPException as error:
            logger.warning("Region Week flag update failed: %s", type(error).__name__)
            return False


def register_region_week_command(tree, region_week):
    @app_commands.command(name="region-week", description="Post the Region Week launch card with the flag reactions")
    @app_commands.guild_only()
    @app_commands.default_permissions(administrator=True)
    @app_commands.describe(
        channel="Where to post it (this channel when empty)",
        ping="Ping @everyone with the card (default: yes)",
        repost="Post again even though this channel already has the card",
    )
    async def region_week_command(interaction: discord.Interaction, channel: discord.TextChannel | None = None,
                                  ping: bool = True, repost: bool = False):
        await region_week.publish(interaction, channel, ping=ping, repost=repost)

    tree.add_command(region_week_command)
