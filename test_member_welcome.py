import asyncio
import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import discord

from member_welcome import DEFAULT_IMAGE_PATH, MemberWelcomeRelay, WELCOME_IMAGE_NAME


SOURCE_CHANNEL_ID = 1401891894329479278
TARGET_CHANNEL_ID = 1421187164187791381
MEMBER_ID = 123456789012345678


def make_user(*, avatar="a_profile_avatar", bot=False):
    return discord.User(
        state=Mock(),
        data={
            "id": str(MEMBER_ID),
            "username": "new_member",
            "discriminator": "0",
            "avatar": avatar,
            "bot": bot,
        },
    )


def http_error(error_type=discord.HTTPException, status=500):
    return error_type(SimpleNamespace(status=status, reason="Test error"), "Test error")


class MemberWelcomeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.guild = Mock(spec=discord.Guild)
        self.guild.id = 1400787114333044887
        self.target = Mock(spec=discord.TextChannel)
        self.target.id = TARGET_CHANNEL_ID
        self.target.guild = self.guild
        self.target.send = AsyncMock()
        self.guild.get_channel.return_value = self.target
        self.guild.fetch_channel = AsyncMock(return_value=self.target)
        self.relay = MemberWelcomeRelay(
            source_channel_id=SOURCE_CHANNEL_ID,
            target_channel_id=TARGET_CHANNEL_ID,
        )

    def message(self, **overrides):
        values = {
            "id": 1422222222222222222,
            "guild": self.guild,
            "channel": SimpleNamespace(id=SOURCE_CHANNEL_ID),
            "type": discord.MessageType.new_member,
            "author": make_user(),
            # Native join messages have no ordinary message content or mentions.
            "content": "",
            "mentions": [],
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    async def test_join_sends_exact_greeting_avatar_and_original_banner_together(self):
        attachment_bytes = []

        async def capture_upload(**kwargs):
            attachment_bytes.append(kwargs["file"].fp.read())

        self.target.send.side_effect = capture_upload
        message = self.message()

        self.assertTrue(await self.relay.handle_message(message))

        self.target.send.assert_awaited_once()
        self.guild.get_channel.assert_called_once_with(TARGET_CHANNEL_ID)
        self.guild.fetch_channel.assert_not_awaited()
        kwargs = self.target.send.call_args.kwargs
        components = kwargs["view"].to_components()
        self.assertEqual(
            components[0]["components"][0]["content"],
            f"Hey , <@{MEMBER_ID}>, welcome to Mindo AI",
        )
        self.assertEqual(
            components[0]["accessory"]["media"]["url"],
            message.author.display_avatar.with_size(256).url,
        )
        self.assertEqual(
            components[1]["items"][0]["media"]["url"],
            f"attachment://{WELCOME_IMAGE_NAME}",
        )
        self.assertEqual(
            kwargs["allowed_mentions"].to_dict(),
            {"users": [MEMBER_ID], "parse": []},
        )
        self.assertFalse(kwargs["allowed_mentions"].replied_user)
        self.assertEqual(kwargs["file"].filename, WELCOME_IMAGE_NAME)
        self.assertTrue(kwargs["file"].fp.closed)
        self.assertEqual(
            hashlib.sha256(attachment_bytes[0]).hexdigest(),
            "12ad1d42f483ce7e130fdda5d72d7420ccaf0a1eb27dff8e072bf868fdc05592",
        )

    async def test_member_without_custom_avatar_uses_discord_default(self):
        message = self.message(author=make_user(avatar=None))

        self.assertTrue(await self.relay.handle_message(message))

        components = self.target.send.call_args.kwargs["view"].to_components()
        self.assertIn(
            "/embed/avatars/",
            components[0]["accessory"]["media"]["url"],
        )

    async def test_guild_specific_avatar_takes_precedence_over_user_avatar(self):
        state = Mock()
        state.store_user.return_value = make_user()
        member = discord.Member(
            data={
                "user": {"id": str(MEMBER_ID)},
                "roles": [],
                "avatar": "guild_avatar",
                "flags": 0,
            },
            guild=self.guild,
            state=state,
        )

        self.assertTrue(await self.relay.handle_message(self.message(author=member)))

        components = self.target.send.call_args.kwargs["view"].to_components()
        self.assertIn(
            f"/guilds/{self.guild.id}/users/{MEMBER_ID}/avatars/guild_avatar",
            components[0]["accessory"]["media"]["url"],
        )

    async def test_ignores_chat_bot_logs_boosts_other_channels_and_dms(self):
        cases = [
            {"type": discord.MessageType.default, "content": "I joined!"},
            {
                "type": discord.MessageType.default,
                "author": make_user(bot=True),
                "mentions": [make_user()],
                "content": f"Welcome <@{MEMBER_ID}>",
            },
            {"type": discord.MessageType.premium_guild_subscription},
            {"channel": SimpleNamespace(id=TARGET_CHANNEL_ID)},
            {"guild": None},
            {"author": make_user(bot=True)},
        ]
        for case in cases:
            with self.subTest(case=case):
                self.assertFalse(await self.relay.handle_message(self.message(**case)))

        self.target.send.assert_not_awaited()
        self.guild.get_channel.assert_not_called()
        self.guild.fetch_channel.assert_not_awaited()

    async def test_either_channel_set_to_zero_disables_welcomes(self):
        for source, target in [(0, TARGET_CHANNEL_ID), (SOURCE_CHANNEL_ID, 0)]:
            relay = MemberWelcomeRelay(
                source_channel_id=source, target_channel_id=target
            )
            self.assertFalse(await relay.handle_message(self.message()))

        self.target.send.assert_not_awaited()

    async def test_fetches_target_when_not_cached(self):
        self.guild.get_channel.return_value = None

        self.assertTrue(await self.relay.handle_message(self.message()))

        self.guild.fetch_channel.assert_awaited_once_with(TARGET_CHANNEL_ID)
        self.target.send.assert_awaited_once()

    async def test_refuses_target_in_a_different_guild(self):
        self.target.guild = SimpleNamespace(id=999)

        with self.assertLogs("member_welcome", level="ERROR"):
            self.assertFalse(await self.relay.handle_message(self.message()))

        self.target.send.assert_not_awaited()

    async def test_refuses_non_text_target(self):
        self.guild.get_channel.return_value = Mock(spec=discord.VoiceChannel)

        with self.assertLogs("member_welcome", level="ERROR"):
            self.assertFalse(await self.relay.handle_message(self.message()))

        self.target.send.assert_not_awaited()

    async def test_repeated_and_concurrent_events_send_once(self):
        async def slow_send(**kwargs):
            await asyncio.sleep(0)

        self.target.send.side_effect = slow_send
        message = self.message()

        results = await asyncio.gather(
            self.relay.handle_message(message), self.relay.handle_message(message)
        )

        self.assertEqual(results, [True, False])
        self.assertFalse(await self.relay.handle_message(message))
        self.target.send.assert_awaited_once()

    async def test_rejoin_with_a_new_system_message_is_welcomed_again(self):
        first = self.message()
        second = self.message(id=first.id + 1)

        self.assertTrue(await self.relay.handle_message(first))
        self.assertTrue(await self.relay.handle_message(second))

        self.assertEqual(self.target.send.await_count, 2)

    async def test_missing_banner_does_not_send_an_incomplete_message(self):
        with tempfile.TemporaryDirectory() as folder:
            self.relay.image_path = Path(folder) / "missing.png"
            with self.assertLogs("member_welcome", level="ERROR"):
                self.assertFalse(await self.relay.handle_message(self.message()))

        self.target.send.assert_not_awaited()
        self.relay.image_path = DEFAULT_IMAGE_PATH
        self.assertTrue(await self.relay.handle_message(self.message()))

    async def test_failed_sends_are_logged_release_attachment_and_allow_retry(self):
        errors = [
            http_error(discord.Forbidden, 403),
            http_error(discord.NotFound, 404),
            http_error(),
        ]
        for error in errors:
            with self.subTest(status=error.status):
                self.target.send.side_effect = error
                with self.assertLogs("member_welcome", level="ERROR"):
                    self.assertFalse(await self.relay.handle_message(self.message()))
                self.assertTrue(self.target.send.call_args.kwargs["file"].fp.closed)

        self.target.send.side_effect = None
        self.assertTrue(await self.relay.handle_message(self.message()))

    async def test_missing_target_is_logged_without_sending(self):
        self.guild.get_channel.return_value = None
        self.guild.fetch_channel.side_effect = http_error(discord.NotFound, 404)

        with self.assertLogs("member_welcome", level="ERROR"):
            self.assertFalse(await self.relay.handle_message(self.message()))

        self.target.send.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
