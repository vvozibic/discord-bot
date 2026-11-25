import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

import discord

from region_week import (
    BANNER_NAME,
    BANNER_PATH,
    COLOUR,
    FLAG_ROLES,
    TEXT_PATH,
    RegionWeek,
    register_region_week_command,
)


GUILD_ID = 1400787114333044887
BOT_ID = 1466831420575186985
CHANNEL_ID = 1400787115008331868
CARD_ID = 1575000000000000001
OTHER_ID = 1575000000000000002
MEMBER_ID = 1182992555982467164
FLAGS = [emoji for emoji, _ in FLAG_ROLES]
INDIA, UKRAINE = "\U0001F1EE\U0001F1F3", "\U0001F1FA\U0001F1E6"
ROLE_OF = dict(FLAG_ROLES)


class FakeRole:
    def __init__(self, role_id, position, name="role"):
        self.id, self.position, self.name = role_id, position, name

    def __lt__(self, other):
        return (self.position, self.id) < (other.position, other.id)

    def __ge__(self, other):
        return not self < other

    def __eq__(self, other):
        return isinstance(other, FakeRole) and other.id == self.id

    def __hash__(self):
        return hash(self.id)


def card_message(message_id=CARD_ID, author_id=BOT_ID, *, banner=True):
    embed = discord.Embed(description="Region Week")
    if banner:
        embed.set_image(url=f"https://cdn.discordapp.com/attachments/1/2/{BANNER_NAME}?ex=current")
    return SimpleNamespace(
        id=message_id, author=SimpleNamespace(id=author_id, bot=True), webhook_id=None, embeds=[embed],
        jump_url=f"https://discord.com/channels/{GUILD_ID}/{CHANNEL_ID}/{message_id}", add_reaction=AsyncMock(),
    )


class RegionWeekTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.week = RegionWeek()
        self.roles = {role_id: FakeRole(role_id, 9 - index, name=emoji)
                      for index, (emoji, role_id) in enumerate(FLAG_ROLES)}
        self.guild = Mock(spec=discord.Guild)
        self.guild.id = GUILD_ID
        self.guild.me = SimpleNamespace(id=BOT_ID, top_role=FakeRole(1467096598898282552, 53),
                                        guild_permissions=discord.Permissions(manage_roles=True))
        self.guild.get_role.side_effect = self.roles.get
        self.guild.get_member.return_value = None
        self.channel = Mock(spec=discord.TextChannel)
        self.channel.id = CHANNEL_ID
        self.channel.guild = self.guild
        self.channel.mention = f"<#{CHANNEL_ID}>"
        self.channel.permissions_for.return_value = discord.Permissions.all()
        self.messages = []
        self.channel.history.side_effect = self.history
        self.uploads = []
        self.partial = SimpleNamespace(remove_reaction=AsyncMock())
        self.channel.get_partial_message.return_value = self.partial
        self.channel.fetch_message = AsyncMock(side_effect=self.fetch)
        self.guild.get_channel_or_thread.return_value = self.channel
        self.guild.fetch_channel = AsyncMock(return_value=self.channel)

        async def send(**kwargs):
            self.uploads.append(kwargs["file"].fp.read())
            card = card_message()
            self.messages.insert(0, card)
            return card

        self.channel.send = AsyncMock(side_effect=send)
        self.client = SimpleNamespace(user=SimpleNamespace(id=BOT_ID),
                                      get_guild=lambda guild_id: self.guild if guild_id == GUILD_ID else None)

    async def history(self, *, limit=None):
        for message in self.messages[:limit]:
            yield message

    async def fetch(self, message_id):
        for message in self.messages:
            if message.id == message_id:
                return message
        raise discord.NotFound(SimpleNamespace(status=404, reason="Not Found"), "Unknown Message")

    def interaction(self, *, administrator=True, guild_id=GUILD_ID):
        response = SimpleNamespace(is_done=Mock(return_value=False), send_message=AsyncMock())

        async def defer(**kwargs):
            response.is_done.return_value = True

        response.defer = AsyncMock(side_effect=defer)
        return SimpleNamespace(
            guild=self.guild, guild_id=guild_id, channel=self.channel,
            permissions=discord.Permissions(administrator=administrator),
            response=response, followup=SimpleNamespace(send=AsyncMock()),
        )

    def member(self, *flags):
        member = SimpleNamespace(id=MEMBER_ID, bot=False, roles=[self.roles[ROLE_OF[flag]] for flag in flags])

        async def add_roles(*roles, reason=None):
            member.roles.extend(role for role in roles if role not in member.roles)

        async def remove_roles(*roles, reason=None):
            member.roles[:] = [role for role in member.roles if role not in roles]

        member.add_roles = AsyncMock(side_effect=add_roles)
        member.remove_roles = AsyncMock(side_effect=remove_roles)
        return member

    def payload(self, flag, *, member=None, user_id=MEMBER_ID, message_id=CARD_ID):
        return SimpleNamespace(guild_id=GUILD_ID, channel_id=CHANNEL_ID, message_id=message_id, user_id=user_id,
                               emoji=discord.PartialEmoji(name=flag), member=member)

    # ---------------------------------------------------------------- posting
    async def test_posts_card_with_ping_banner_text_and_flags_in_order(self):
        interaction = self.interaction()
        await self.week.publish(interaction)
        self.channel.send.assert_awaited_once()
        kwargs = self.channel.send.call_args.kwargs
        self.assertEqual(kwargs["content"], "@everyone")
        self.assertTrue(kwargs["allowed_mentions"].everyone)
        self.assertFalse(kwargs["allowed_mentions"].roles)
        embed = kwargs["embed"]
        self.assertEqual(embed.colour.value, COLOUR)
        self.assertEqual(embed.image.url, f"attachment://{BANNER_NAME}")
        self.assertEqual(embed.description, TEXT_PATH.read_text(encoding="utf-8").strip())
        self.assertEqual(kwargs["file"].filename, BANNER_NAME)
        self.assertEqual(self.uploads, [BANNER_PATH.read_bytes()])
        self.assertTrue(kwargs["file"].fp.closed)
        card = self.messages[0]
        self.assertEqual([call.args[0] for call in card.add_reaction.await_args_list], FLAGS)
        interaction.response.defer.assert_awaited_once_with(ephemeral=True, thinking=True)
        reply = interaction.followup.send.call_args
        self.assertIn(card.jump_url, reply.args[0])
        self.assertTrue(reply.kwargs["ephemeral"])

    async def test_quiet_post_has_no_mentions_and_needs_no_mention_permission(self):
        permissions = discord.Permissions.all()
        permissions.mention_everyone = False
        self.channel.permissions_for.return_value = permissions
        await self.week.publish(self.interaction(), self.channel, ping=False)
        kwargs = self.channel.send.call_args.kwargs
        self.assertIsNone(kwargs["content"])
        self.assertEqual(kwargs["allowed_mentions"].to_dict(), {"parse": []})

    async def test_non_admin_or_other_server_is_refused_privately(self):
        for case in ({"administrator": False}, {"guild_id": 1}):
            with self.subTest(**case):
                interaction = self.interaction(**case)
                await self.week.publish(interaction)
                self.channel.send.assert_not_awaited()
                self.assertTrue(interaction.response.send_message.call_args.kwargs["ephemeral"])

    async def test_missing_channel_permissions_block_the_post(self):
        for name in ("add_reactions", "manage_messages", "mention_everyone", "attach_files"):
            with self.subTest(permission=name):
                permissions = discord.Permissions.all()
                setattr(permissions, name, False)
                self.channel.permissions_for.return_value = permissions
                interaction = self.interaction()
                await self.week.publish(interaction)
                self.channel.send.assert_not_awaited()
                self.assertIn(name.replace("_", " "), interaction.followup.send.call_args.args[0])

    async def test_region_role_at_or_above_the_bot_blocks_the_post(self):
        self.roles[ROLE_OF[INDIA]].position = 60
        interaction = self.interaction()
        await self.week.publish(interaction)
        self.channel.send.assert_not_awaited()
        self.assertIn("above", interaction.followup.send.call_args.args[0])

    async def test_existing_card_needs_repost(self):
        self.messages.append(card_message())
        interaction = self.interaction()
        await self.week.publish(interaction)
        self.channel.send.assert_not_awaited()
        self.assertIn("repost", interaction.followup.send.call_args.args[0])
        await self.week.publish(self.interaction(), repost=True)
        self.channel.send.assert_awaited_once()

    # ---------------------------------------------------------------- flags
    async def test_flag_on_card_switches_region_role_and_old_reaction(self):
        self.messages.append(card_message())
        member = self.member(INDIA)
        self.assertTrue(await self.week.handle_reaction(self.client, self.payload(UKRAINE, member=member), added=True))
        self.assertEqual(member.roles, [self.roles[ROLE_OF[UKRAINE]]])
        self.partial.remove_reaction.assert_awaited_once_with(INDIA, member)

    async def test_first_flag_only_adds_its_role(self):
        self.messages.append(card_message())
        member = self.member()
        await self.week.handle_reaction(self.client, self.payload(INDIA, member=member), added=True)
        self.assertEqual(member.roles, [self.roles[ROLE_OF[INDIA]]])
        member.remove_roles.assert_not_awaited()
        self.partial.remove_reaction.assert_not_awaited()

    async def test_removing_flag_takes_the_role_back(self):
        self.messages.append(card_message())
        member = self.member(INDIA)
        self.guild.fetch_member = AsyncMock(return_value=member)
        self.assertTrue(await self.week.handle_reaction(self.client, self.payload(INDIA), added=False))
        self.guild.fetch_member.assert_awaited_once_with(MEMBER_ID)
        self.assertEqual(member.roles, [])

    async def test_flags_elsewhere_are_ignored_and_checked_once(self):
        self.messages.append(card_message(OTHER_ID, author_id=159985870458322944))
        member = self.member()
        for _ in range(2):
            self.assertFalse(await self.week.handle_reaction(
                self.client, self.payload(INDIA, member=member, message_id=OTHER_ID), added=True))
        self.channel.fetch_message.assert_awaited_once_with(OTHER_ID)
        member.add_roles.assert_not_awaited()

    async def test_bot_custom_emoji_and_other_servers_are_ignored(self):
        self.messages.append(card_message())
        member = self.member()
        own = self.payload(INDIA, member=member, user_id=BOT_ID)
        custom = self.payload(INDIA, member=member)
        custom.emoji = discord.PartialEmoji(name="004", id=1420713409346928650)
        elsewhere = self.payload(INDIA, member=member)
        elsewhere.guild_id = 1
        for payload in (own, custom, elsewhere):
            self.assertFalse(await self.week.handle_reaction(self.client, payload, added=True))
        member.add_roles.assert_not_awaited()
        self.channel.fetch_message.assert_not_awaited()

    async def test_card_is_recognised_after_a_restart_by_its_banner(self):
        self.messages.append(card_message())
        member = self.member()
        restarted = RegionWeek()
        self.assertTrue(await restarted.handle_reaction(self.client, self.payload(INDIA, member=member), added=True))
        self.assertEqual(member.roles, [self.roles[ROLE_OF[INDIA]]])
        self.assertFalse(RegionWeek.is_card(card_message(banner=False), BOT_ID))
        self.assertFalse(RegionWeek.is_card(card_message(author_id=1470503084164644946), BOT_ID))


class AssetAndCommandTests(unittest.TestCase):
    def test_assets_are_bundled_and_fit_an_embed(self):
        self.assertEqual(BANNER_PATH.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
        text = TEXT_PATH.read_text(encoding="utf-8").strip()
        self.assertLess(len(text), 4096)
        self.assertIn("Region Week", text)
        self.assertEqual(len(FLAGS), 9)
        self.assertEqual(len(set(ROLE_OF.values())), 9)

    def test_command_is_admin_only_and_guild_only(self):
        tree = SimpleNamespace(add_command=Mock())
        register_region_week_command(tree, RegionWeek())
        command = tree.add_command.call_args.args[0]
        self.assertEqual(command.name, "region-week")
        self.assertTrue(command.default_permissions.administrator)
        self.assertTrue(command.guild_only)
        self.assertEqual([parameter.name for parameter in command.parameters], ["channel", "ping", "repost"])

    def test_bot_wires_the_command_and_both_reaction_events(self):
        tree = ast.parse(Path(__file__).with_name("bot.py").read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == "register_region_week_command"]
        self.assertEqual(len(calls), 1)
        self.assertEqual([arg.id for arg in calls[0].args], ["tree", "region_week"])
        events = {node.name: node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)}
        for name, added in (("on_raw_reaction_add", True), ("on_raw_reaction_remove", False)):
            with self.subTest(event=name):
                self.assertIn(name, events)
                call = next(node for node in ast.walk(events[name]) if isinstance(node, ast.Call)
                            and isinstance(node.func, ast.Attribute) and node.func.attr == "handle_reaction")
                self.assertEqual(call.keywords[0].arg, "added")
                self.assertIs(call.keywords[0].value.value, added)


if __name__ == "__main__":
    unittest.main()
