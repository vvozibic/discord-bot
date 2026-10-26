import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import discord
from discord import app_commands

from game_launcher import GameSettings, launch_forest_trail, register_game_command


def interaction(**overrides):
    values = {
        "guild_id": 1400787114333044887,
        "channel_id": 1421187164187791381,
        "application_id": 1470503084164644946,
        "permissions": discord.Permissions(administrator=True),
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
    def test_defaults_reuse_existing_activity_and_private_test_channel(self):
        settings = GameSettings.from_env({})
        self.assertEqual(settings.activity_id, 1556624227212460092)
        self.assertEqual(settings.test_channel_id, 1421187164187791381)
        self.assertEqual(settings.activity_url, "https://discord.com/activities/1556624227212460092")

    def test_invalid_settings_do_not_become_unrestricted(self):
        for name in ("FOREST_TRAIL_ACTIVITY_ID", "FOREST_TRAIL_GUILD_ID", "FOREST_TRAIL_TEST_CHANNEL_ID"):
            for value in ("", "0", "-1", "https://example.com", "123456789012345/elsewhere"):
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    GameSettings.from_env({name: value})
        with self.assertRaises(ValueError):
            GameSettings.from_env({"FOREST_TRAIL_ENABLED": "maybe"})


class LauncherTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_bot_returns_game_button_without_wrong_application_callback(self):
        item = interaction()
        await launch_forest_trail(item, GameSettings())
        item.response.launch_activity.assert_not_awaited()
        item.response.send_message.assert_awaited_once()
        kwargs = item.response.send_message.call_args.kwargs
        self.assertTrue(kwargs["ephemeral"])
        self.assertEqual(kwargs["allowed_mentions"].to_dict(), {"parse": []})
        button = kwargs["view"].to_components()[0]["components"][0]
        self.assertEqual(button["style"], 5)
        self.assertEqual(button["url"], "https://discord.com/activities/1556624227212460092")
        self.assertNotIn("custom_id", button)
        self.assertEqual(kwargs["embed"].title, "Forest Trail")

    async def test_same_application_can_launch_activity_directly(self):
        item = interaction(application_id=1556624227212460092)
        await launch_forest_trail(item, GameSettings())
        item.response.launch_activity.assert_awaited_once_with()
        item.response.send_message.assert_not_awaited()

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

    async def test_registration_preserves_existing_commands_and_has_admin_default(self):
        client = discord.Client(intents=discord.Intents.none())
        tree = app_commands.CommandTree(client)

        @tree.command(name="existing")
        async def existing(item: discord.Interaction):
            pass

        command = register_game_command(tree)
        self.assertIs(tree.get_command("existing"), existing)
        self.assertIs(tree.get_command("play"), command)
        self.assertEqual(command.default_permissions.value, 8)
        self.assertTrue(command.guild_only)
        item = interaction()
        with patch("game_launcher.launch_forest_trail", new_callable=AsyncMock) as launch:
            await command.callback(item)
        launch.assert_awaited_once_with(item)
        await client.close()


class IntegrationTests(unittest.TestCase):
    def test_bot_registers_command_once_after_tree_creation(self):
        tree = ast.parse(Path(__file__).with_name("bot.py").read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == "register_game_command"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].args[0].id, "tree")


if __name__ == "__main__":
    unittest.main()
