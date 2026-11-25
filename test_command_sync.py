import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

from command_sync import ENTRY_POINT, sync_global_commands


APP = 1466831420575186985
ENTRY = {"id": "1564583887970238544", "application_id": str(APP), "version": "1564583887970238545",
         "type": ENTRY_POINT, "handler": 2, "name": "launch", "description": "", "contexts": [0, 1, 2],
         "integration_types": [0, 1], "default_member_permissions": None, "nsfw": False}
OLD = {"id": "1470720277007564813", "application_id": str(APP), "version": "1", "type": 1, "name": "verify",
       "description": "Verify"}


def command(name):
    return SimpleNamespace(to_dict=Mock(return_value={"name": name, "type": 1, "description": name}))


def make(existing):
    tree = SimpleNamespace(get_commands=Mock(return_value=[command("verify"), command("region-week")]),
                           translator=None, sync=AsyncMock(return_value=["synced by the tree"]))

    async def upsert(application_id, payload):
        return [{**item, "id": item.get("id", str(index)), "application_id": str(application_id)}
                for index, item in enumerate(payload, start=1)]

    client = SimpleNamespace(application_id=APP, _connection=Mock(),
                             http=SimpleNamespace(get_global_commands=AsyncMock(return_value=existing),
                                                  bulk_upsert_global_commands=AsyncMock(side_effect=upsert)))
    return tree, client


class CommandSyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_keeps_the_entry_point_and_updates_everything_else(self):
        tree, client = make([OLD, ENTRY])
        synced = await sync_global_commands(tree, client)
        client.http.get_global_commands.assert_awaited_once_with(APP)
        payload = client.http.bulk_upsert_global_commands.call_args.kwargs["payload"]
        self.assertEqual([item["name"] for item in payload], ["verify", "region-week", "launch"])
        entry = payload[-1]
        self.assertEqual((entry["id"], entry["type"], entry["handler"]), (ENTRY["id"], ENTRY_POINT, 2))
        self.assertNotIn("version", entry)
        self.assertNotIn("application_id", entry)
        tree.sync.assert_not_awaited()
        self.assertEqual([command.name for command in synced], ["verify", "region-week", "launch"])

    async def test_without_an_entry_point_it_is_the_normal_tree_sync(self):
        tree, client = make([OLD])
        self.assertEqual(await sync_global_commands(tree, client), ["synced by the tree"])
        tree.sync.assert_awaited_once_with()
        client.http.bulk_upsert_global_commands.assert_not_awaited()


class BotWiringTests(unittest.TestCase):
    def test_on_ready_uses_it_for_the_global_sync_only(self):
        tree = ast.parse(Path(__file__).with_name("bot.py").read_text(encoding="utf-8"))
        on_ready = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "on_ready")
        calls = [node for node in ast.walk(on_ready) if isinstance(node, ast.Call)]
        helper = [call for call in calls if isinstance(call.func, ast.Name) and call.func.id == "sync_global_commands"]
        self.assertEqual(len(helper), 1)
        self.assertEqual([arg.id for arg in helper[0].args], ["tree", "client"])
        tree_syncs = [call for call in calls if isinstance(call.func, ast.Attribute) and call.func.attr == "sync"
                      and isinstance(call.func.value, ast.Name) and call.func.value.id == "tree"]
        self.assertEqual(len(tree_syncs), 1)
        self.assertEqual(tree_syncs[0].keywords[0].arg, "guild")


if __name__ == "__main__":
    unittest.main()
