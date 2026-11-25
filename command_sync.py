"""Global slash-command sync that keeps the Activity's Entry Point command.

Discord refuses a global bulk overwrite that leaves out an app's Entry Point command (error 50240), and
discord.py's CommandTree.sync() sends only the tree's own commands. Since the Forest Trail Activity got its
"launch" Entry Point, every global sync failed, so commands added after it never appeared. This sends the
tree's commands together with the existing Entry Point, so it is kept and everything else is updated.
"""

from discord import app_commands


ENTRY_POINT = 4  # ApplicationCommandType.PRIMARY_ENTRY_POINT
WRITABLE = ("id", "name", "type", "handler", "description", "name_localizations", "description_localizations",
            "default_member_permissions", "integration_types", "contexts", "nsfw")


async def sync_global_commands(tree, client):
    if client.application_id is None:
        raise app_commands.MissingApplicationID
    existing = await client.http.get_global_commands(client.application_id)
    keep = [{key: value for key, value in command.items() if key in WRITABLE}
            for command in existing if command.get("type") == ENTRY_POINT]
    if not keep:
        return await tree.sync()
    commands = tree.get_commands()
    translator = tree.translator
    if translator:
        payload = [await command.get_translated_payload(tree, translator) for command in commands]
    else:
        payload = [command.to_dict(tree) for command in commands]
    data = await client.http.bulk_upsert_global_commands(client.application_id, payload=payload + keep)
    return [app_commands.AppCommand(data=item, state=client._connection) for item in data]
