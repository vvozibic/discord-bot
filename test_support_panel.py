import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import discord

from support_panel import BANNER_NAME, BANNER_PATH, SupportPanel, register_support_commands


BOT_ID = 1470503084164644946
CARD_ID = 1566840569165258873
TICKET_ID = 1566840688304201873


def make_message(author_id=BOT_ID, *, card=False, message_id=CARD_ID, webhook_id=None):
    embed = discord.Embed(title="Support")
    if card:
        embed.set_image(url=f"https://cdn.discordapp.com/attachments/1/2/{BANNER_NAME}?signature=current")
    message = SimpleNamespace(
        id=message_id, author=SimpleNamespace(id=author_id, bot=True),
        webhook_id=webhook_id, type=discord.MessageType.default,
        embeds=[embed] if card else [], flags=discord.MessageFlags(),
        jump_url=f"https://discord.com/channels/1400787114333044887/1400849374732615762/{message_id}",
        edit=AsyncMock(),
    )
    message.edit.return_value = message
    return message


class SupportPanelTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.panel = SupportPanel()
        self.messages = []
        self.guild = Mock(spec=discord.Guild)
        self.guild.id = self.panel.guild_id
        self.guild.me = SimpleNamespace(id=BOT_ID)
        self.channel = Mock(spec=discord.TextChannel)
        self.channel.id = self.panel.channel_id
        self.channel.guild = self.guild
        self.channel.permissions_for.return_value = discord.Permissions.all()
        self.channel.fetch_message = AsyncMock()
        self.guild.get_channel.return_value = self.channel
        self.guild.fetch_channel = AsyncMock(return_value=self.channel)
        self.channel.history.side_effect = self.history
        self.uploads = []

        async def send(**kwargs):
            self.uploads.append(kwargs["file"].fp.read())
            card = make_message(card=True)
            self.messages.insert(0, card)
            return card

        self.channel.send = AsyncMock(side_effect=send)

    async def history(self, *, limit=None, before=None):
        messages = [message for message in self.messages
                    if before is None or message.id < before.id]
        for message in messages if limit is None else messages[:limit]:
            yield message

    def interaction(self, *, administrator=True, guild_id=None):
        response = SimpleNamespace(is_done=Mock(return_value=False),
                                   send_message=AsyncMock())

        async def defer(**kwargs):
            response.is_done.return_value = True

        response.defer = AsyncMock(side_effect=defer)
        return SimpleNamespace(
            guild=self.guild, guild_id=self.panel.guild_id if guild_id is None else guild_id,
            channel_id=1421187164187791381,
            permissions=discord.Permissions(administrator=administrator),
            client=SimpleNamespace(user=SimpleNamespace(id=BOT_ID)),
            response=response, followup=SimpleNamespace(send=AsyncMock()),
        )

    def ticket(self, **kwargs):
        return SimpleNamespace(
            **vars(make_message(self.panel.ticket_tool_id, message_id=TICKET_ID, **kwargs)),
            guild=self.guild, channel=self.channel,
        )

    async def test_publishes_bundled_banner_as_current_bot_to_configured_channel(self):
        interaction = self.interaction()
        await self.panel.publish(interaction)
        self.channel.send.assert_awaited_once()
        self.guild.get_channel.assert_called_with(self.panel.channel_id)
        kwargs = self.channel.send.call_args.kwargs
        self.assertEqual(self.uploads, [BANNER_PATH.read_bytes()])
        self.assertEqual(kwargs["file"].filename, BANNER_NAME)
        self.assertTrue(kwargs["file"].fp.closed)
        self.assertEqual(kwargs["embed"].image.url, f"attachment://{BANNER_NAME}")
        self.assertNotIn("TEST", kwargs["embed"].title)
        self.assertEqual(kwargs["allowed_mentions"].to_dict(), {"parse": []})
        self.assertNotIn("view", kwargs)  # Never counterfeit Ticket Tool's button.
        interaction.response.defer.assert_awaited_once_with(ephemeral=True, thinking=True)
        self.assertIn(self.messages[0].jump_url, interaction.followup.send.call_args.args[0])
        self.assertTrue(interaction.followup.send.call_args.kwargs["ephemeral"])

    async def test_repeated_or_concurrent_publication_does_not_duplicate_card(self):
        await asyncio.gather(self.panel.publish(self.interaction()),
                             self.panel.publish(self.interaction()))
        self.channel.send.assert_awaited_once()
        self.messages[0].edit.assert_awaited_once()
        kwargs = self.messages[0].edit.call_args.kwargs
        self.assertEqual(len(kwargs["attachments"]), 1)
        self.assertEqual(kwargs["attachments"][0].filename, BANNER_NAME)

    async def test_restart_finds_own_card_and_does_not_edit_test_bots_card(self):
        own = make_message(card=True)
        other = make_message(1556624227212460092, card=True)
        self.messages[:] = [other, own]
        await SupportPanel().publish(self.interaction())
        self.channel.send.assert_not_awaited()
        own.edit.assert_awaited_once()
        other.edit.assert_not_awaited()

    async def test_missing_permissions_or_asset_prevent_public_post(self):
        for missing in ("manage_messages", "attach_files", "read_message_history"):
            with self.subTest(missing=missing):
                permissions = discord.Permissions.all()
                setattr(permissions, missing, False)
                self.channel.permissions_for.return_value = permissions
                with self.assertLogs("support_panel", level="WARNING"):
                    await self.panel.publish(self.interaction())
        self.channel.permissions_for.return_value = discord.Permissions.all()
        self.panel.banner_path = Path("missing-support-banner.png")
        with self.assertLogs("support_panel", level="WARNING"):
            await self.panel.publish(self.interaction())
        self.channel.send.assert_not_awaited()

    async def test_non_admin_or_wrong_server_cannot_publish_or_toggle(self):
        for interaction in (self.interaction(administrator=False),
                            self.interaction(guild_id=1400787114333044888)):
            await self.panel.publish(interaction)
            await self.panel.set_ticket_panel(interaction, str(TICKET_ID), suppressed=True)
            interaction.response.defer.assert_not_awaited()
            self.guild.get_channel.assert_not_called()
            for call in interaction.response.send_message.call_args_list:
                self.assertTrue(call.kwargs["ephemeral"])

    async def test_wrong_channel_type_or_guild_prevents_publication(self):
        for channel in (Mock(spec=discord.Thread), self.channel):
            self.guild.get_channel.return_value = channel
            self.channel.guild = SimpleNamespace(id=0)
            with self.assertLogs("support_panel", level="WARNING"):
                await self.panel.publish(self.interaction())
        self.channel.send.assert_not_awaited()

    async def test_cache_miss_fetches_the_configured_channel(self):
        self.guild.get_channel.return_value = None
        await self.panel.publish(self.interaction())
        self.guild.fetch_channel.assert_awaited_once_with(self.panel.channel_id)
        self.channel.send.assert_awaited_once()

    async def test_hide_and_restore_only_toggle_flags_on_verified_ticket_tool_message(self):
        ticket = self.ticket()
        self.channel.fetch_message.return_value = ticket
        for suppressed in (True, False):
            await self.panel.set_ticket_panel(self.interaction(), str(TICKET_ID), suppressed=suppressed)
            self.channel.fetch_message.assert_awaited_with(TICKET_ID)
            ticket.edit.assert_awaited_with(suppress=suppressed)
        self.channel.send.assert_not_awaited()

    async def test_manual_toggle_rejects_other_bots_webhooks_and_invalid_ids(self):
        for message in (make_message(), self.ticket(webhook_id=123)):
            self.channel.fetch_message.return_value = message
            with self.assertLogs("support_panel", level="WARNING"):
                await self.panel.set_ticket_panel(self.interaction(), str(TICKET_ID), suppressed=True)
            message.edit.assert_not_awaited()
        with self.assertLogs("support_panel", level="WARNING"):
            await self.panel.set_ticket_panel(self.interaction(), "not-a-message-id", suppressed=True)

    async def test_native_ticket_event_immediately_after_own_banner_keeps_button(self):
        self.messages[:] = [make_message(card=True)]
        ticket = self.ticket()  # No embeds/components or content access needed.
        self.assertTrue(await self.panel.handle_message(ticket))
        ticket.edit.assert_awaited_once_with(suppress=True)
        self.channel.history.assert_called_once_with(limit=1, before=ticket)

    async def test_passive_handler_does_not_change_old_panels_or_panels_after_other_messages(self):
        ticket = self.ticket()
        for messages in ([], [make_message(card=True, message_id=TICKET_ID + 1)],
                         [make_message(card=False)], [make_message(1556624227212460092, card=True)]):
            self.messages[:] = messages
            self.assertFalse(await self.panel.handle_message(ticket))
        ticket.edit.assert_not_awaited()

    async def test_passive_handler_skips_other_guild_channel_or_author(self):
        for change in ({"guild": None}, {"channel": SimpleNamespace(id=0)},
                       {"guild": SimpleNamespace(id=0)}, {"author": SimpleNamespace(id=BOT_ID, bot=True)},
                       {"webhook_id": 123}):
            ticket = self.ticket()
            ticket.__dict__.update(change)
            self.assertFalse(await self.panel.handle_message(ticket))
            ticket.edit.assert_not_awaited()
        self.channel.history.assert_not_called()

    async def test_forbidden_passive_edit_does_not_break_other_message_handlers(self):
        self.messages[:] = [make_message(card=True)]
        ticket = self.ticket()
        ticket.edit.side_effect = discord.Forbidden(SimpleNamespace(status=403, reason="Forbidden"), "Missing permissions")
        with self.assertLogs("support_panel", level="WARNING"):
            self.assertFalse(await self.panel.handle_message(ticket))

    async def test_duplicate_passive_event_does_not_edit_already_hidden_panel(self):
        self.messages[:] = [make_message(card=True)]
        ticket = self.ticket()
        ticket.flags.suppress_embeds = True
        self.assertTrue(await self.panel.handle_message(ticket))
        ticket.edit.assert_not_awaited()

    async def test_registration_preserves_other_commands_and_checks_admin_at_runtime(self):
        client = discord.Client(intents=discord.Intents.none())
        tree = discord.app_commands.CommandTree(client)
        register_support_commands(tree, self.panel)
        self.assertEqual({command.name for command in tree.get_commands()},
                         {"support-panel", "support-hide", "support-restore"})
        for command in tree.get_commands():
            self.assertTrue(command.guild_only)
            self.assertEqual(command.default_permissions.value, 8)
        interaction = self.interaction(administrator=False)
        await tree.get_command("support-panel").callback(interaction)
        self.channel.send.assert_not_awaited()
        await client.close()


class SettingsTests(unittest.TestCase):
    def test_defaults_and_configured_ids(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(SupportPanel.from_env().channel_id, 1400849374732615762)
        with patch.dict("os.environ", {"SUPPORT_CHANNEL_ID": "1421187164187791381"}):
            self.assertEqual(SupportPanel.from_env().channel_id, 1421187164187791381)
        with patch.dict("os.environ", {"SUPPORT_TICKET_TOOL_ID": "invalid"}):
            with self.assertRaisesRegex(ValueError, "SUPPORT_TICKET_TOOL_ID"):
                SupportPanel.from_env()


if __name__ == "__main__":
    unittest.main()
