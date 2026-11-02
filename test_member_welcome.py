import asyncio
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import aiohttp
import discord
from PIL import Image

from member_welcome import DEFAULT_IMAGE_PATH, MemberWelcomeRelay, WELCOME_IMAGE_NAME


SOURCE_CHANNEL_ID = 1401891894329479278
TARGET_CHANNEL_ID = 1421187164187791381
MEMBER_ID = 123456789012345678


def make_user(*, avatar="a_profile_avatar", bot=False, global_name=None):
    return discord.User(
        state=Mock(),
        data={
            "id": str(MEMBER_ID),
            "username": "new_member",
            "global_name": global_name,
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
        self.guild.text_channels = []
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
        avatar = BytesIO()
        Image.new("RGB", (64, 48), (120, 180, 255)).save(avatar, format="PNG")
        self.avatar_bytes = avatar.getvalue()
        self.avatar_urls = []

        async def read_avatar(asset):
            self.avatar_urls.append(asset.url)
            return self.avatar_bytes

        self.avatar_read = self.enterContext(
            patch("discord.Asset.read", autospec=True, side_effect=read_avatar)
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

    async def test_join_sends_display_name_and_personalized_card_together(self):
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
            components[0]["content"],
            "Hey, **new\\_member**, welcome to Mindo AI\nNext stop: <#1422969379062284389>",
        )
        self.assertEqual(
            components[1]["items"][0]["media"]["url"],
            f"attachment://{WELCOME_IMAGE_NAME}",
        )
        self.assertEqual(
            kwargs["allowed_mentions"].to_dict(),
            {"parse": []},
        )
        self.assertFalse(kwargs["allowed_mentions"].replied_user)
        self.assertEqual(kwargs["file"].filename, WELCOME_IMAGE_NAME)
        self.assertTrue(kwargs["file"].fp.closed)
        self.avatar_read.assert_awaited_once()
        with Image.open(BytesIO(attachment_bytes[0])) as card:
            self.assertEqual(card.format, "PNG")
            self.assertEqual(card.size, (1280, 640))
            self.assertEqual(card.getpixel((640, 256))[:3], (120, 180, 255))
        self.assertNotEqual(attachment_bytes[0], DEFAULT_IMAGE_PATH.read_bytes())

    async def test_member_without_custom_avatar_uses_discord_default(self):
        message = self.message(author=make_user(avatar=None))

        self.assertTrue(await self.relay.handle_message(message))

        self.assertIn("/embed/avatars/", self.avatar_urls[0])

    async def test_guild_specific_avatar_takes_precedence_over_user_avatar(self):
        state = Mock()
        state.store_user.return_value = make_user()
        member = discord.Member(
            data={
                "user": {"id": str(MEMBER_ID)},
                "nick": "Server nickname",
                "roles": [],
                "avatar": "guild_avatar",
                "flags": 0,
            },
            guild=self.guild,
            state=state,
        )

        self.assertTrue(await self.relay.handle_message(self.message(author=member)))

        components = self.target.send.call_args.kwargs["view"].to_components()
        self.assertEqual(
            components[0]["content"],
            "Hey, **Server nickname**, welcome to Mindo AI\nNext stop: <#1422969379062284389>",
        )
        self.assertIn(
            f"/guilds/{self.guild.id}/users/{MEMBER_ID}/avatars/guild_avatar",
            self.avatar_urls[0],
        )

    async def test_display_name_falls_back_to_global_name_then_username(self):
        for global_name, expected_name in [
            ("Global display", "Global display"),
            (None, r"new\_member"),
        ]:
            for as_member in (False, True):
                with self.subTest(global_name=global_name, as_member=as_member):
                    user = make_user(global_name=global_name)
                    author = user
                    if as_member:
                        state = Mock()
                        state.store_user.return_value = user
                        author = discord.Member(
                            data={"user": {"id": str(MEMBER_ID)}, "roles": [], "flags": 0},
                            guild=self.guild,
                            state=state,
                        )

                    message = self.message(
                        id=1422222222222222223 + self.target.send.await_count,
                        author=author,
                    )
                    self.assertTrue(await self.relay.handle_message(message))

                    components = self.target.send.call_args.kwargs["view"].to_components()
                    self.assertEqual(
                        components[0]["content"],
                        f"Hey, **{expected_name}**, welcome to Mindo AI\nNext stop: <#1422969379062284389>",
                    )

    async def test_display_name_cannot_inject_markdown_or_mentions(self):
        author = make_user(
            global_name=f"**Nick** <@{MEMBER_ID}> @everyone @here"
        )

        self.assertTrue(await self.relay.handle_message(self.message(author=author)))

        kwargs = self.target.send.call_args.kwargs
        greeting = kwargs["view"].to_components()[0]["content"]
        self.assertEqual(
            greeting,
            r"Hey, **\*\*Nick\*\* <@"
            "\u200b123456789012345678> @\u200beveryone @\u200bhere**, welcome to Mindo AI\nNext stop: <#1422969379062284389>",
        )
        self.assertEqual(kwargs["allowed_mentions"].to_dict(), {"parse": []})

    async def test_next_stop_links_to_exact_id_without_relying_on_channel_name_or_cache(self):
        for index, channels in enumerate([
            [],
            [SimpleNamespace(name="renamed-chat", id=1422969379062284389)],
            [SimpleNamespace(name="general-chat", id=987654321)],
        ]):
            with self.subTest(channels=channels):
                self.guild.text_channels = channels

                self.assertTrue(
                    await self.relay.handle_message(
                        self.message(id=1422222222222222223 + index)
                    )
                )

                components = self.target.send.call_args.kwargs["view"].to_components()
                self.assertIn("Next stop: <#1422969379062284389>", components[0]["content"])

    async def test_avatar_download_failure_still_sends_a_personalized_card(self):
        attachment_bytes = []

        async def capture_upload(**kwargs):
            attachment_bytes.append(kwargs["file"].fp.read())

        self.target.send.side_effect = capture_upload
        for error in [http_error(discord.NotFound, 404), aiohttp.ClientError(), TimeoutError()]:
            with self.subTest(error=type(error).__name__):
                self.avatar_read.side_effect = error
                message = self.message(id=1422222222222222223 + len(attachment_bytes))
                with self.assertLogs("member_welcome", level="WARNING"):
                    self.assertTrue(await self.relay.handle_message(message))

        self.assertEqual(len(attachment_bytes), 3)
        for card_bytes in attachment_bytes:
            with Image.open(BytesIO(card_bytes)) as card:
                self.assertEqual(card.size, (1280, 640))

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
