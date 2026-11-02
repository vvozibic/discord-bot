from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

import discord
from discord import app_commands

from faq_announcement import FAQSettings, build_faq
from faq_editor import MAX_IMAGE_BYTES, open_faq_editor, parse_message_id, register_faq_editor


class MessageReferenceTests(unittest.TestCase):
    def test_accepts_message_id_and_matching_discord_link(self):
        settings = FAQSettings()
        for value in (
            "1438216822397862060",
            "https://discord.com/channels/1400787114333044887/1438216307618222121/1438216822397862060",
        ):
            self.assertEqual(parse_message_id(value, settings), 1438216822397862060)

    def test_rejects_foreign_channels_and_malformed_references(self):
        for value in (
            "", "0", "-1", str(2**64), "https://example.com/channels/1/2/3",
            "https://discord.com/channels/1400787114333044887/123/456",
            "https://discord.com/channels/123/1438216307618222121/456",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_message_id(value, FAQSettings())


class FAQEditorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings = FAQSettings(publish_enabled=True)
        self.user = SimpleNamespace(id=123456789012345678)
        self.bot_user = SimpleNamespace(id=1466831420575186985)
        self.bot_member = object()
        self.guild = Mock(spec=discord.Guild)
        self.guild.id = self.settings.guild_id
        self.guild.me = self.bot_member
        self.channel = Mock(spec=discord.TextChannel)
        self.channel.id = self.settings.channel_id
        self.channel.guild = self.guild
        self.channel.send = AsyncMock()
        self.guild.get_channel.return_value = self.channel
        self.guild.fetch_channel = AsyncMock(return_value=self.channel)
        self.caller_permissions = discord.Permissions(manage_messages=True)
        self.bot_permissions = discord.Permissions(
            view_channel=True, read_message_history=True, embed_links=True, attach_files=True,
        )
        self.channel.permissions_for.side_effect = lambda member: (
            self.bot_permissions if member is self.bot_member else self.caller_permissions
        )
        self.message = Mock(spec=discord.Message)
        self.message.id = 1560000000000000001
        self.message.channel = self.channel
        self.message.guild = self.guild
        self.message.author = self.bot_user
        self.message.webhook_id = None
        self.message.components = []
        self.message.embeds = [build_faq()[0]]
        self.message.attachments = [SimpleNamespace(id=1560000000000000002)]
        self.message.edited_at = None
        self.message.jump_url = "https://discord.com/channels/1400787114333044887/1438216307618222121/1560000000000000001"
        self.message.edit = AsyncMock()
        self.message.delete = AsyncMock()
        self.channel.fetch_message = AsyncMock(return_value=self.message)

    def interaction(self):
        response = SimpleNamespace(is_done=Mock(return_value=False), send_message=AsyncMock(), send_modal=AsyncMock())

        async def defer(**kwargs):
            response.is_done.return_value = True

        response.defer = AsyncMock(side_effect=defer)
        return SimpleNamespace(
            guild=self.guild, guild_id=self.guild.id, user=self.user,
            permissions=discord.Permissions(manage_messages=True),
            client=SimpleNamespace(user=self.bot_user),
            response=response, followup=SimpleNamespace(send=AsyncMock()),
        )

    async def editor(self, **kwargs):
        item = self.interaction()
        await open_faq_editor(item, str(self.message.id), settings=self.settings, **kwargs)
        item.response.send_modal.assert_awaited_once()
        return item.response.send_modal.call_args.args[0]

    async def test_opening_context_editor_prefills_current_text_without_a_write(self):
        modal = await self.editor(message=self.message)
        self.assertEqual(modal.faq_title.value, self.message.embeds[0].title)
        self.assertEqual(modal.faq_text.value, self.message.embeds[0].description)
        self.channel.fetch_message.assert_not_awaited()
        self.message.edit.assert_not_awaited()
        self.channel.send.assert_not_awaited()

    async def test_opening_slash_editor_fetches_only_configured_message(self):
        await self.editor()
        self.channel.fetch_message.assert_awaited_once_with(self.message.id)
        self.message.edit.assert_not_awaited()

    async def test_default_flag_disables_editing_before_reading_a_message(self):
        item = self.interaction()
        await open_faq_editor(item, str(self.message.id), settings=FAQSettings())
        self.channel.fetch_message.assert_not_awaited()
        item.response.send_modal.assert_not_awaited()
        self.assertIn("disabled", item.response.send_message.call_args.args[0])

    async def test_other_bots_old_mee6_post_cannot_be_edited(self):
        self.message.author = SimpleNamespace(id=1421173420036591767)
        item = self.interaction()
        await open_faq_editor(item, str(self.message.id), settings=self.settings)
        item.response.send_modal.assert_not_awaited()
        self.message.edit.assert_not_awaited()
        self.assertIn("another bot", item.response.send_message.call_args.args[0])

    async def test_interactive_panels_are_not_treated_as_static_faq(self):
        self.message.components = [object()]
        item = self.interaction()
        await open_faq_editor(item, str(self.message.id), settings=self.settings)
        item.response.send_modal.assert_not_awaited()

    async def test_text_edit_preserves_image_and_attachments_without_reposting(self):
        modal = await self.editor()
        old_image = self.message.embeds[0].image.url
        modal.faq_title._value = "Updated FAQ"
        modal.faq_text._value = "Updated **answer** with [roles](https://discord.com/channels/1/2)."
        item = self.interaction()
        await modal.on_submit(item)
        self.message.edit.assert_awaited_once()
        kwargs = self.message.edit.call_args.kwargs
        self.assertEqual(kwargs["embed"].title, "Updated FAQ")
        self.assertIn("Updated **answer**", kwargs["embed"].description)
        self.assertEqual(kwargs["embed"].image.url, old_image)
        self.assertNotIn("attachments", kwargs)
        self.assertEqual(kwargs["allowed_mentions"].to_dict()["parse"], [])
        self.assertEqual(self.message.embeds[0].title, "<:004:1420713409346928650> MindoAI Quick Q&A")
        self.message.delete.assert_not_awaited()
        self.channel.send.assert_not_awaited()
        self.assertIn(self.message.jump_url, item.followup.send.call_args.args[0])

    async def test_replacement_image_is_uploaded_to_the_existing_message(self):
        image = SimpleNamespace(content_type="image/png", size=5, read=AsyncMock(return_value=b"image"))
        modal = await self.editor(image=image)
        uploaded = []

        async def capture(**kwargs):
            uploaded.append(kwargs["attachments"][0].fp.read())

        self.message.edit.side_effect = capture
        await modal.on_submit(self.interaction())
        self.assertEqual(uploaded, [b"image"])
        kwargs = self.message.edit.call_args.kwargs
        self.assertEqual(kwargs["embed"].image.url, "attachment://mindo-faq-edited.png")
        self.assertTrue(kwargs["attachments"][0].fp.closed)
        self.channel.send.assert_not_awaited()
        self.message.delete.assert_not_awaited()

    async def test_extra_attachments_are_preserved_by_rejecting_image_replacement(self):
        image = SimpleNamespace(content_type="image/png", size=5, read=AsyncMock(return_value=b"image"))
        self.message.attachments.append(SimpleNamespace(id=1560000000000000003))
        modal = await self.editor(image=image)
        await modal.on_submit(self.interaction())
        image.read.assert_not_awaited()
        self.message.edit.assert_not_awaited()

    async def test_bad_image_types_and_sizes_are_rejected_before_opening_editor(self):
        for image in (
            SimpleNamespace(content_type="text/plain", size=5),
            SimpleNamespace(content_type="image/png", size=MAX_IMAGE_BYTES + 1),
        ):
            with self.subTest(image=image):
                item = self.interaction()
                await open_faq_editor(item, str(self.message.id), image=image, settings=self.settings)
                item.response.send_modal.assert_not_awaited()

    async def test_stale_form_does_not_overwrite_a_more_recent_edit(self):
        modal = await self.editor()
        self.message.embeds[0].description = "Another administrator's update"
        item = self.interaction()
        await modal.on_submit(item)
        self.message.edit.assert_not_awaited()
        self.assertIn("changed while", item.followup.send.call_args.args[0])

    async def test_permissions_and_author_are_checked_again_on_save(self):
        modal = await self.editor()
        self.caller_permissions = discord.Permissions.none()
        await modal.on_submit(self.interaction())
        self.message.edit.assert_not_awaited()
        self.caller_permissions = discord.Permissions(manage_messages=True)
        self.message.author = SimpleNamespace(id=1421173420036591767)
        await modal.on_submit(self.interaction())
        self.message.edit.assert_not_awaited()

    async def test_wrong_user_and_disabled_flag_cannot_save(self):
        modal = await self.editor()
        item = self.interaction()
        item.user = SimpleNamespace(id=999)
        await modal.on_submit(item)
        self.message.edit.assert_not_awaited()
        modal.settings = FAQSettings()
        await modal.on_submit(self.interaction())
        self.message.edit.assert_not_awaited()

    async def test_deleted_message_is_not_recreated(self):
        modal = await self.editor()
        self.channel.fetch_message.side_effect = discord.NotFound(SimpleNamespace(status=404, reason="Not found"), "Not found")
        item = self.interaction()
        await modal.on_submit(item)
        self.message.edit.assert_not_awaited()
        self.channel.send.assert_not_awaited()
        self.assertIn("Nothing was recreated", item.followup.send.call_args.args[0])

    async def test_failed_edit_is_not_retried(self):
        modal = await self.editor()
        self.message.edit.side_effect = discord.HTTPException(SimpleNamespace(status=500, reason="Error"), "Error")
        item = self.interaction()
        await modal.on_submit(item)
        self.message.edit.assert_awaited_once()
        self.channel.send.assert_not_awaited()
        self.assertIn("before retrying", item.followup.send.call_args.args[0])

    async def test_missing_channel_access_does_not_open_editor(self):
        self.guild.get_channel.return_value = None
        self.guild.fetch_channel.side_effect = discord.Forbidden(SimpleNamespace(status=403, reason="Forbidden"), "Forbidden")
        item = self.interaction()
        await open_faq_editor(item, str(self.message.id), settings=self.settings)
        item.response.send_modal.assert_not_awaited()
        self.message.edit.assert_not_awaited()

    async def test_registration_provides_slash_command_and_message_context_menu(self):
        client = discord.Client(intents=discord.Intents.none())
        tree = app_commands.CommandTree(client)
        slash, menu = register_faq_editor(tree)
        self.assertIs(tree.get_command("faqedit"), slash)
        self.assertIs(tree.get_command("Edit FAQ", type=discord.AppCommandType.message), menu)
        self.assertTrue(slash.guild_only)
        self.assertTrue(menu.guild_only)
        self.assertTrue(slash.default_permissions.manage_messages)
        self.assertTrue(menu.default_permissions.manage_messages)


if __name__ == "__main__":
    unittest.main()
