import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import discord
from discord import app_commands

from game_launcher import ForestTrailView, GameSettings, launch_forest_trail, publish_game_panel, register_game_command


def interaction(**overrides):
    values = {
        "guild_id": 1400787114333044887,
        "channel_id": 1421187164187791381,
        "application_id": 1470503084164644946,
        "permissions": discord.Permissions(administrator=True),
        "user": SimpleNamespace(roles=[]),
        "response": SimpleNamespace(
            is_done=Mock(return_value=False),
            send_message=AsyncMock(),
            launch_activity=AsyncMock(),
        ),
        "followup": SimpleNamespace(send=AsyncMock()),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class SettingsTests(unittest.TestCase):
    def test_defaults_use_responding_bot_application_and_exact_beta_scope(self):
        settings = GameSettings.from_env({})
        self.assertIsNone(settings.activity_id)
        self.assertEqual(settings.test_channel_id, 1421187164187791381)
        self.assertEqual(settings.beta_channel_id, 1564277364089823285)
        self.assertEqual(settings.beta_role_id, 1564276225520963726)

    def test_invalid_settings_do_not_become_unrestricted(self):
        for name in ("FOREST_TRAIL_ACTIVITY_ID", "FOREST_TRAIL_GUILD_ID", "FOREST_TRAIL_TEST_CHANNEL_ID",
                     "FOREST_TRAIL_BETA_CHANNEL_ID", "FOREST_TRAIL_BETA_ROLE_ID"):
            for value in ("", "0", "-1", "https://example.com", "123456789012345/elsewhere"):
                if name == "FOREST_TRAIL_ACTIVITY_ID" and value == "":
                    continue
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    GameSettings.from_env({name: value})
        with self.assertRaises(ValueError):
            GameSettings.from_env({"FOREST_TRAIL_ENABLED": "maybe"})


class LauncherTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_bot_launches_its_own_activity_without_a_website_link(self):
        item = interaction()
        await launch_forest_trail(item, GameSettings())
        item.response.launch_activity.assert_awaited_once_with()
        item.response.send_message.assert_not_awaited()

    async def test_same_application_can_launch_activity_directly(self):
        item = interaction(application_id=1556624227212460092)
        await launch_forest_trail(item, GameSettings())
        item.response.launch_activity.assert_awaited_once_with()
        item.response.send_message.assert_not_awaited()

    async def test_beta_role_launches_inside_discord(self):
        item = interaction(channel_id=1564277364089823285,
                           application_id=1556624227212460092,
                           permissions=discord.Permissions.none(),
                           user=SimpleNamespace(roles=[SimpleNamespace(id=1564276225520963726)]))
        await launch_forest_trail(item, GameSettings())
        item.response.launch_activity.assert_awaited_once_with()
        item.response.send_message.assert_not_awaited()

    async def test_beta_requires_exact_role_and_channel_and_guild(self):
        tester = SimpleNamespace(roles=[SimpleNamespace(id=1564276225520963726)])
        cases = (
            {"user": SimpleNamespace(roles=[])},
            {"user": SimpleNamespace(roles=[SimpleNamespace(id=1564276225520963727, name="beta-tester")])},
            {"channel_id": 1421187164187791381},
            {"channel_id": 1400848157436280943},
            {"channel_id": 1569999999999999999},
            {"guild_id": 1400000000000000000},
            {"guild_id": None},
        )
        for case in cases:
            with self.subTest(case=case):
                values = {"channel_id": 1564277364089823285,
                          "permissions": discord.Permissions.none(), "user": tester, **case}
                item = interaction(**values)
                await launch_forest_trail(item, GameSettings())
                item.response.launch_activity.assert_not_awaited()
                self.assertNotIn("view", item.response.send_message.call_args.kwargs)

    async def test_beta_administrator_can_play_without_assigning_tester_role(self):
        item = interaction(channel_id=1564277364089823285)
        await launch_forest_trail(item, GameSettings())
        item.response.launch_activity.assert_awaited_once_with()

    async def test_configured_other_application_is_rejected_without_browser_fallback(self):
        item = interaction()
        await launch_forest_trail(item, GameSettings(activity_id=1556624227212460092))
        item.response.launch_activity.assert_not_awaited()
        self.assertNotIn("view", item.response.send_message.call_args.kwargs)
        self.assertTrue(item.response.send_message.call_args.kwargs["ephemeral"])

    async def test_disable_also_blocks_beta_testers(self):
        item = interaction(channel_id=1564277364089823285,
                           permissions=discord.Permissions.none(),
                           user=SimpleNamespace(roles=[SimpleNamespace(id=1564276225520963726)]))
        await launch_forest_trail(item, GameSettings(enabled=False))
        self.assertNotIn("view", item.response.send_message.call_args.kwargs)

    async def test_rejects_wrong_channel_guild_dms_threads_and_non_admins(self):
        cases = (
            {"channel_id": 1400848157436280943},
            {"channel_id": 1569999999999999999},
            {"guild_id": 1400000000000000000},
            {"guild_id": None, "channel_id": 1421187164187791381},
            {"permissions": discord.Permissions(manage_guild=True)},
        )
        for case in cases:
            with self.subTest(case=case):
                item = interaction(**case)
                await launch_forest_trail(item, GameSettings())
                item.response.launch_activity.assert_not_awaited()
                kwargs = item.response.send_message.call_args.kwargs
                self.assertTrue(kwargs["ephemeral"])
                self.assertNotIn("view", kwargs)

    async def test_disabled_game_does_not_launch(self):
        item = interaction()
        await launch_forest_trail(item, GameSettings(enabled=False))
        item.response.launch_activity.assert_not_awaited()
        self.assertNotIn("view", item.response.send_message.call_args.kwargs)

    async def test_invalid_game_config_does_not_raise_in_existing_bot(self):
        item = interaction()
        with patch.dict("os.environ", {"FOREST_TRAIL_ACTIVITY_ID": "bad"}):
            await launch_forest_trail(item)
        item.response.launch_activity.assert_not_awaited()
        self.assertIn("configuration", item.response.send_message.call_args.args[0])

    async def test_native_discord_error_is_private_and_does_not_leak_response(self):
        item = interaction(application_id=1556624227212460092)
        response = SimpleNamespace(status=400, reason="Bad request")
        item.response.launch_activity.side_effect = discord.HTTPException(response, "private server response")
        await launch_forest_trail(item, GameSettings())
        item.response.send_message.assert_awaited_once()
        self.assertNotIn("private server response", item.response.send_message.call_args.args[0])
        self.assertTrue(item.response.send_message.call_args.kwargs["ephemeral"])

    async def test_registration_preserves_commands_and_allows_beta_members_to_invoke(self):
        client = discord.Client(intents=discord.Intents.none())
        tree = app_commands.CommandTree(client)

        @tree.command(name="existing")
        async def existing(item: discord.Interaction):
            pass

        command = register_game_command(tree)
        self.assertIs(tree.get_command("existing"), existing)
        self.assertIs(tree.get_command("play"), command)
        self.assertIsNone(command.default_permissions)
        self.assertTrue(command.guild_only)
        panel = tree.get_command("game-panel")
        self.assertIsNotNone(panel)
        self.assertEqual(panel.default_permissions.value, 8)
        item = interaction()
        with patch("game_launcher.launch_forest_trail", new_callable=AsyncMock) as launch:
            await command.callback(item)
        launch.assert_awaited_once_with(item)
        await client.close()

    async def test_persistent_panel_button_reuses_authorization_after_a_restart(self):
        view = ForestTrailView()
        self.assertTrue(view.is_persistent())
        button = view.children[0]
        self.assertEqual(button.custom_id, "forest-trail:play")
        self.assertIsNone(button.url)
        item = interaction(channel_id=1400848157436280943)
        await button.callback(item)
        item.response.launch_activity.assert_not_awaited()
        self.assertTrue(item.response.send_message.call_args.kwargs["ephemeral"])

    async def test_only_administrator_can_publish_a_panel_in_allowed_channel(self):
        item = interaction(channel_id=1564277364089823285)
        await publish_game_panel(item, GameSettings())
        kwargs = item.response.send_message.call_args.kwargs
        self.assertFalse(kwargs["ephemeral"])
        self.assertEqual(kwargs["allowed_mentions"].to_dict(), {"parse": []})
        self.assertTrue(kwargs["view"].is_persistent())
        for case in ({"channel_id":1400848157436280943}, {"permissions":discord.Permissions.none()}, {"guild_id":None}):
            item = interaction(**case)
            await publish_game_panel(item, GameSettings())
            self.assertTrue(item.response.send_message.call_args.kwargs["ephemeral"])
            self.assertNotIn("view", item.response.send_message.call_args.kwargs)


class IntegrationTests(unittest.TestCase):
    def test_bot_registers_command_once_after_tree_creation(self):
        tree = ast.parse(Path(__file__).with_name("bot.py").read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == "register_game_command"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].args[0].id, "tree")

    def test_bot_registers_the_persistent_game_view_with_other_existing_views(self):
        tree = ast.parse(Path(__file__).with_name("bot.py").read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Attribute) and node.func.attr == "add_view"]
        names = [call.args[0].func.id for call in calls if call.args and isinstance(call.args[0], ast.Call)
                 and isinstance(call.args[0].func, ast.Name)]
        self.assertEqual(names.count("ForestTrailView"), 1)
        self.assertIn("FAQView", names)
        self.assertIn("BelieverCampaignView", names)


if __name__ == "__main__":
    unittest.main()
