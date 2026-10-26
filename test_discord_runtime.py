import ast
import copy
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import discord

from discord_runtime import (
    MESSAGE_CONTENT_UNAVAILABLE,
    build_bot_intents,
    require_message_content,
)


BOT_SOURCE = ast.parse(Path(__file__).with_name("bot.py").read_text(encoding="utf-8"))


def load_callback(name, namespace, *, class_name=None):
    """Exercise real callbacks without importing OCR models or the bot runtime."""
    source = BOT_SOURCE.body
    if class_name:
        source = next(node for node in source if isinstance(node, ast.ClassDef)
                      and node.name == class_name).body
    callback = copy.deepcopy(next(node for node in source
                                  if isinstance(node, ast.AsyncFunctionDef)
                                  and node.name == name))
    callback.decorator_list = []
    module = ast.Module(body=[callback], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), "bot.py", "exec"), namespace)
    return namespace[name]


def interaction(*, deferred=False):
    return SimpleNamespace(
        guild=SimpleNamespace(id=1400787114333044887),
        user=Mock(spec=discord.Member),
        response=SimpleNamespace(
            is_done=Mock(return_value=deferred),
            send_message=AsyncMock(),
            defer=AsyncMock(),
        ),
        followup=SimpleNamespace(send=AsyncMock()),
    )


class IntentTests(unittest.TestCase):
    def test_default_startup_does_not_request_any_privileged_intent(self):
        intents = build_bot_intents({})
        self.assertTrue(intents.guilds)
        self.assertTrue(intents.guild_messages)
        self.assertFalse(intents.message_content)
        self.assertFalse(intents.members)
        self.assertFalse(intents.presences)

    def test_message_content_access_requires_explicit_opt_in(self):
        for value in ("true", "1", " TRUE "):
            with self.subTest(value=value):
                intents = build_bot_intents({"DISCORD_MESSAGE_CONTENT_INTENT": value})
                self.assertTrue(intents.message_content)
                self.assertFalse(intents.members)
                self.assertFalse(intents.presences)
        for value in ("", "false", "0", " FALSE "):
            with self.subTest(value=value):
                self.assertFalse(build_bot_intents(
                    {"DISCORD_MESSAGE_CONTENT_INTENT": value}
                ).message_content)
        with self.assertRaisesRegex(ValueError, "DISCORD_MESSAGE_CONTENT_INTENT"):
            build_bot_intents({"DISCORD_MESSAGE_CONTENT_INTENT": "maybe"})

    def test_environment_is_used_when_no_mapping_is_provided(self):
        with patch.dict("os.environ", {"DISCORD_MESSAGE_CONTENT_INTENT": "true"}):
            self.assertTrue(build_bot_intents().message_content)

    def test_real_bot_initialization_uses_optional_intents(self):
        assignment = next(node for node in BOT_SOURCE.body
                          if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == "intents"
                                  for target in node.targets))
        namespace = {"build_bot_intents": lambda: build_bot_intents({})}
        exec(compile(ast.Module(body=[assignment], type_ignores=[]), "bot.py", "exec"), namespace)
        self.assertFalse(namespace["intents"].message_content)
        self.assertFalse(namespace["intents"].members)
        self.assertFalse(namespace["intents"].presences)


class ContentGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_disabled_access_explains_unavailability_privately(self):
        for deferred in (False, True):
            with self.subTest(deferred=deferred):
                item = interaction(deferred=deferred)
                self.assertFalse(await require_message_content(item, build_bot_intents({})))
                sent = item.followup.send if deferred else item.response.send_message
                other = item.response.send_message if deferred else item.followup.send
                sent.assert_awaited_once()
                self.assertEqual(sent.call_args.args, (MESSAGE_CONTENT_UNAVAILABLE,))
                self.assertTrue(sent.call_args.kwargs["ephemeral"])
                self.assertFalse(sent.call_args.kwargs["allowed_mentions"].everyone)
                other.assert_not_awaited()

    async def test_enabled_access_leaves_the_interaction_available(self):
        item = interaction()
        self.assertTrue(await require_message_content(
            item, build_bot_intents({"DISCORD_MESSAGE_CONTENT_INTENT": "true"})
        ))
        item.response.send_message.assert_not_awaited()
        item.followup.send.assert_not_awaited()

    async def test_content_callbacks_stop_before_history_or_eligibility_changes(self):
        cases = (
            ("export_108_hours_no_duplicates_cmd", None, {}),
            ("export_150_hours_no_duplicates_links_cmd", None, {}),
            ("_run_message_audit_command", None, {
                "start": "2026-10-26", "end": "2026-10-26",
                "timezone_name": "Europe/Warsaw", "winner_count": 1,
                "channel": None, "default_channel_id": 123, "image_only": False,
            }),
            ("_run_message_audit_command", None, {
                "start": "2026-10-26", "end": "2026-10-26",
                "timezone_name": "Europe/Warsaw", "winner_count": 1,
                "channel": None, "default_channel_id": 123, "image_only": True,
            }),
            ("participate", "BelieverCampaignView", {}),
        )
        for name, class_name, kwargs in cases:
            with self.subTest(callback=name, image_only=kwargs.get("image_only")):
                item = interaction()
                namespace = {
                    "discord": discord,
                    "client": SimpleNamespace(intents=build_bot_intents({})),
                    "require_message_content": require_message_content,
                    "require_export_command_role": AsyncMock(return_value=True),
                }
                callback = load_callback(name, namespace, class_name=class_name)
                args = (None, item, None) if class_name else (item,)
                # No history, export or role helpers are supplied: reaching one
                # would fail rather than quietly accepting restricted data.
                await callback(*args, **kwargs)
                item.response.send_message.assert_awaited_once()
                self.assertEqual(item.response.send_message.call_args.args,
                                 (MESSAGE_CONTENT_UNAVAILABLE,))
                item.response.defer.assert_not_awaited()
                item.followup.send.assert_not_awaited()

    async def test_enabled_campaign_callbacks_keep_the_existing_content_path(self):
        class ReachedHistory(Exception):
            pass

        for name, class_name in (
            ("export_108_hours_no_duplicates_cmd", None),
            ("export_150_hours_no_duplicates_links_cmd", None),
            ("participate", "BelieverCampaignView"),
        ):
            with self.subTest(callback=name):
                item = interaction()
                history_channel = AsyncMock(side_effect=ReachedHistory)
                namespace = {
                    "discord": discord,
                    "client": SimpleNamespace(intents=build_bot_intents(
                        {"DISCORD_MESSAGE_CONTENT_INTENT": "true"}
                    )),
                    "require_message_content": require_message_content,
                    "require_export_command_role": AsyncMock(return_value=True),
                    "BELIEVER_PROOF_CHANNEL_ID": 123,
                    "get_believer_proof_channel": history_channel,
                }
                callback = load_callback(name, namespace, class_name=class_name)
                with self.assertRaises(ReachedHistory):
                    await callback(*(None, item, None) if class_name else (item,))
                history_channel.assert_awaited_once_with(item.guild)
                item.response.send_message.assert_not_awaited()

    async def test_restricted_passive_events_keep_welcomes_and_skip_proof_moderation(self):
        for enabled in (False, True):
            with self.subTest(enabled=enabled):
                welcome = AsyncMock()
                duplicate_check = AsyncMock()
                namespace = {
                    "discord": discord,
                    "client": SimpleNamespace(intents=build_bot_intents({
                        "DISCORD_MESSAGE_CONTENT_INTENT": str(enabled).lower(),
                    })),
                    "member_welcome_relay": SimpleNamespace(handle_message=welcome),
                    "maybe_delete_duplicate_believer_x_proof": duplicate_check,
                }
                received = load_callback("on_message", namespace)
                edited = load_callback("on_message_edit", namespace)
                message = object()
                await received(message)
                await edited(object(), message)
                welcome.assert_awaited_once_with(message)
                if enabled:
                    self.assertEqual(duplicate_check.await_count, 2)
                else:
                    duplicate_check.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
