import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import discord
from discord import app_commands

from faq_announcement import (
    FAQSettings,
    build_faq,
    export_preview,
    handle_faq_command,
    register_faq_command,
)


def discord_error(error_type=discord.Forbidden, status=403):
    return error_type(SimpleNamespace(status=status, reason="Test error"), "Test error")


class FAQContentTests(unittest.TestCase):
    def test_document_snapshot_has_all_six_questions_and_bundled_image(self):
        embed, image = build_faq()
        self.assertEqual(embed.title, "<:004:1420713409346928650> MindoAI Quick Q&A")
        for question in (
            "What is MindoAI?", "Where is MindoAI going? Is there a roadmap?",
            "I'm new. Where do I start?", "How do I earn roles?", "When is TGE?",
            "How do I stay safe?",
        ):
            self.assertIn(f"**{question}**\n", embed.description)
        self.assertIn("**When is TGE?**\nSoon.", embed.description)
        self.assertIn("1. Turn on the MND tag and claim your role.", embed.description)
        self.assertIn("**KOL Rounds:**", embed.description)
        self.assertLessEqual(len(embed.description), 4096)
        self.assertLessEqual(len(embed), 6000)
        self.assertEqual(embed.image.url, "attachment://mindo-faq-document.png")
        self.assertEqual(image.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

    def test_local_preview_is_portable_and_has_a_publish_disabled_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")):
                preview = export_preview(directory)
            html = preview.read_text(encoding="utf-8")
            self.assertIn("data:image/png;base64,", html)
            self.assertIn("Nothing has been published", html)
            self.assertIn("<strong>What is MindoAI?</strong>", html)
            payload = json.loads((Path(directory) / "faq-payload.json").read_text(encoding="utf-8"))
            self.assertFalse(payload["publication_enabled"])
            self.assertEqual(payload["target_channel_id"], "1438216307618222121")
            self.assertEqual(payload["message"]["allowed_mentions"], {"parse": []})

    def test_settings_default_to_no_publication_and_reject_malformed_scope(self):
        self.assertFalse(FAQSettings.from_env({}).publish_enabled)
        self.assertTrue(FAQSettings.from_env({"FAQ_PUBLISH_ENABLED": "true"}).publish_enabled)
        for env in (
            {"FAQ_PUBLISH_ENABLED": "maybe"}, {"FAQ_GUILD_ID": ""},
            {"FAQ_CHANNEL_ID": "0"}, {"FAQ_CHANNEL_ID": "-1"},
            {"FAQ_CHANNEL_ID": "https://discord.com/channels/1/2"},
            {"FAQ_CHANNEL_ID": str(2**64)},
        ):
            with self.subTest(env=env), self.assertRaises(ValueError):
                FAQSettings.from_env(env)


class FAQCommandTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings = FAQSettings()
        self.user = SimpleNamespace(id=123456789012345678)
        self.bot_member = object()
        self.guild = Mock(spec=discord.Guild)
        self.guild.id = self.settings.guild_id
        self.guild.me = self.bot_member
        self.channel = Mock(spec=discord.TextChannel)
        self.channel.id = self.settings.channel_id
        self.channel.guild = self.guild
        self.channel.send = AsyncMock(return_value=SimpleNamespace(jump_url="https://discord.com/channels/1/2/3"))
        self.caller_permissions = discord.Permissions(manage_messages=True)
        self.bot_permissions = discord.Permissions(view_channel=True, send_messages=True, embed_links=True, attach_files=True)
        self.channel.permissions_for.side_effect = lambda member: (
            self.bot_permissions if member is self.bot_member else self.caller_permissions
        )
        self.guild.get_channel.return_value = self.channel
        self.guild.fetch_channel = AsyncMock(return_value=self.channel)
        self.item = SimpleNamespace(
            guild=self.guild,
            guild_id=self.guild.id,
            user=self.user,
            permissions=discord.Permissions(manage_messages=True),
            response=SimpleNamespace(send_message=AsyncMock(), defer=AsyncMock()),
            followup=SimpleNamespace(send=AsyncMock()),
        )

    async def test_default_command_only_sends_a_private_preview(self):
        await handle_faq_command(self.item, settings=self.settings)
        kwargs = self.item.response.send_message.call_args.kwargs
        self.assertTrue(kwargs["ephemeral"])
        self.assertEqual(kwargs["file"].filename, "mindo-faq-document.png")
        self.assertTrue(kwargs["file"].fp.closed)
        self.assertEqual(kwargs["allowed_mentions"].to_dict()["parse"], [])
        self.guild.get_channel.assert_not_called()
        self.guild.fetch_channel.assert_not_awaited()
        self.channel.send.assert_not_awaited()

    async def test_preview_stays_private_even_when_publication_is_enabled(self):
        await handle_faq_command(self.item, settings=FAQSettings(publish_enabled=True))
        self.assertTrue(self.item.response.send_message.call_args.kwargs["ephemeral"])
        self.channel.send.assert_not_awaited()

    async def test_explicit_publish_is_blocked_by_default(self):
        await handle_faq_command(self.item, publish=True, settings=self.settings)
        self.assertIn("disabled", self.item.response.send_message.call_args.args[0])
        self.guild.get_channel.assert_not_called()
        self.channel.send.assert_not_awaited()

    async def test_env_flag_is_off_when_not_configured(self):
        with patch.dict("os.environ", {}, clear=True):
            await handle_faq_command(self.item, publish=True)
        self.channel.send.assert_not_awaited()

    async def test_caller_without_manage_messages_is_blocked(self):
        self.item.permissions = discord.Permissions.none()
        await handle_faq_command(self.item, settings=self.settings)
        self.assertIn("Manage Messages", self.item.response.send_message.call_args.args[0])
        self.channel.send.assert_not_awaited()

    async def test_dm_and_other_servers_are_blocked(self):
        for guild, guild_id in ((None, None), (self.guild, 123456789012345678)):
            with self.subTest(guild_id=guild_id):
                self.item.guild, self.item.guild_id = guild, guild_id
                await handle_faq_command(self.item, publish=True, settings=FAQSettings(publish_enabled=True))
        self.guild.get_channel.assert_not_called()
        self.channel.send.assert_not_awaited()

    async def test_missing_image_does_not_result_in_a_partial_post(self):
        with patch("faq_announcement.build_faq", side_effect=ValueError("Missing image")):
            await handle_faq_command(self.item, publish=True, settings=FAQSettings(publish_enabled=True))
        self.item.response.defer.assert_not_awaited()
        self.channel.send.assert_not_awaited()

    async def test_explicitly_enabled_publish_only_uses_configured_destination(self):
        self.item.channel = Mock(spec=discord.TextChannel)
        self.item.channel.send = AsyncMock()
        await handle_faq_command(self.item, publish=True, settings=FAQSettings(publish_enabled=True))
        self.guild.get_channel.assert_called_once_with(self.settings.channel_id)
        self.channel.send.assert_awaited_once()
        self.item.channel.send.assert_not_awaited()
        kwargs = self.channel.send.call_args.kwargs
        self.assertEqual(kwargs["embed"].title, "<:004:1420713409346928650> MindoAI Quick Q&A")
        self.assertEqual(kwargs["allowed_mentions"].to_dict()["parse"], [])
        self.item.response.defer.assert_awaited_once_with(ephemeral=True, thinking=True)
        self.assertTrue(self.item.followup.send.call_args.kwargs["ephemeral"])

    async def test_destination_permissions_are_checked_for_caller_and_bot(self):
        self.caller_permissions = discord.Permissions.none()
        await handle_faq_command(self.item, publish=True, settings=FAQSettings(publish_enabled=True))
        self.channel.send.assert_not_awaited()
        self.caller_permissions = discord.Permissions(manage_messages=True)
        self.bot_permissions.attach_files = False
        await handle_faq_command(self.item, publish=True, settings=FAQSettings(publish_enabled=True))
        self.channel.send.assert_not_awaited()
        self.assertIn("Attach Files", self.item.followup.send.call_args.args[0])

    async def test_destination_in_another_guild_is_rejected(self):
        self.channel.guild = SimpleNamespace(id=123456789012345678)
        await handle_faq_command(self.item, publish=True, settings=FAQSettings(publish_enabled=True))
        self.channel.send.assert_not_awaited()

    async def test_missing_channel_access_fails_without_posting(self):
        self.guild.get_channel.return_value = None
        self.guild.fetch_channel.side_effect = discord_error()
        await handle_faq_command(self.item, publish=True, settings=FAQSettings(publish_enabled=True))
        self.channel.send.assert_not_awaited()
        self.assertIn("denied access", self.item.followup.send.call_args.args[0])

    async def test_uncertain_discord_error_does_not_retry_publication(self):
        self.channel.send.side_effect = discord_error(discord.HTTPException, 500)
        await handle_faq_command(self.item, publish=True, settings=FAQSettings(publish_enabled=True))
        self.channel.send.assert_awaited_once()
        self.assertIn("before retrying", self.item.followup.send.call_args.args[0])

    async def test_confirmation_failure_does_not_repeat_successful_post(self):
        self.item.followup.send.side_effect = discord_error(discord.HTTPException, 500)
        with self.assertRaises(discord.HTTPException):
            await handle_faq_command(self.item, publish=True, settings=FAQSettings(publish_enabled=True))
        self.channel.send.assert_awaited_once()

    async def test_registration_exposes_preview_default_without_starting_bot(self):
        client = discord.Client(intents=discord.Intents.none())
        tree = app_commands.CommandTree(client)
        command = register_faq_command(tree)
        self.assertEqual(command.name, "faqpost")
        self.assertTrue(command.guild_only)
        self.assertTrue(command.default_permissions.manage_messages)
        self.assertFalse(command.parameters[0].default)
        self.assertIs(tree.get_command("faqpost"), command)


if __name__ == "__main__":
    unittest.main()
