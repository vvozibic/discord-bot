"""Document FAQ preparation and explicitly enabled, administrator-requested posting.

The command defaults to a private preview. Importing this module and exporting a
preview never log in to Discord, sync commands, or publish a message.
"""

import argparse
import base64
from contextlib import closing
from dataclasses import dataclass
import html
import json
import os
from pathlib import Path
import re

import discord


ROOT = Path(__file__).resolve().parent
CONTENT_PATH = ROOT / "faq_content.json"


@dataclass(frozen=True)
class FAQSettings:
    publish_enabled: bool = False
    guild_id: int = 1400787114333044887
    channel_id: int = 1438216307618222121

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        enabled = env.get("FAQ_PUBLISH_ENABLED", "false").strip().lower()
        if enabled not in {"false", "0", "true", "1"}:
            raise ValueError("FAQ_PUBLISH_ENABLED must be true or false")
        values = {}
        for name, default in (("FAQ_GUILD_ID", cls.guild_id), ("FAQ_CHANNEL_ID", cls.channel_id)):
            raw = env.get(name, str(default)).strip()
            if not raw.isascii() or not raw.isdigit() or not 0 < int(raw) < 2**64:
                raise ValueError(f"{name} must be a Discord ID")
            values[name] = int(raw)
        return cls(enabled in {"true", "1"}, values["FAQ_GUILD_ID"], values["FAQ_CHANNEL_ID"])


def build_faq(content_path=CONTENT_PATH):
    """Read the approved document snapshot and require its bundled artwork."""
    path = Path(content_path)
    content = json.loads(path.read_text(encoding="utf-8"))
    image = (path.parent / content["image"]).resolve()
    if not image.is_file():
        raise ValueError("The FAQ image is missing")
    questions = content["questions"]
    if not questions or any(not item["question"].strip() or not item["answer"].strip() for item in questions):
        raise ValueError("Every FAQ question needs an answer")
    description = "\n\n".join(f"**{item['question']}**\n{item['answer']}" for item in questions)
    embed = discord.Embed(title=content["title"], description=description, color=content["color"])
    if len(embed.title) > 256 or len(description) > 4096 or len(embed) > 6000:
        raise ValueError("The FAQ exceeds Discord embed limits")
    embed.set_image(url=f"attachment://{image.name}")
    return embed, image


async def handle_faq_command(interaction, *, publish=False, settings=None):
    """Keep previews private; public posting needs both an explicit option and a flag."""
    mentions = discord.AllowedMentions.none()

    async def reply(text):
        await interaction.response.send_message(text, ephemeral=True, allowed_mentions=mentions)

    try:
        settings = settings or FAQSettings.from_env()
    except ValueError as error:
        await reply(str(error))
        return
    if interaction.guild is None or interaction.guild_id != settings.guild_id:
        await reply("This FAQ is configured for the Mindo AI server only.")
        return
    if not interaction.permissions.manage_messages:
        await reply("You need Manage Messages permission to prepare this FAQ.")
        return
    if publish and not settings.publish_enabled:
        await reply("Public FAQ posting is disabled. Use /faqpost without publish for a private preview.")
        return
    try:
        embed, image = build_faq()
    except (OSError, ValueError, KeyError, TypeError):
        await reply("The FAQ content or image is unavailable. No message was published.")
        return
    if not publish:
        with closing(discord.File(image, filename=image.name)) as attachment:
            await interaction.response.send_message(
                embed=embed, file=attachment, ephemeral=True, allowed_mentions=mentions,
            )
        return

    await interaction.response.defer(ephemeral=True, thinking=True)

    async def result(text):
        await interaction.followup.send(text, ephemeral=True, allowed_mentions=mentions)

    try:
        channel = interaction.guild.get_channel(settings.channel_id)
        if channel is None:
            channel = await interaction.guild.fetch_channel(settings.channel_id)
        if not isinstance(channel, discord.TextChannel) or channel.guild.id != settings.guild_id:
            await result("The configured FAQ destination is not a text channel in this server.")
            return
        if not channel.permissions_for(interaction.user).manage_messages:
            await result("You need Manage Messages permission in the FAQ channel.")
            return
        member = interaction.guild.me
        required = ("view_channel", "send_messages", "embed_links", "attach_files")
        permissions = channel.permissions_for(member) if member is not None else None
        if permissions is None or not all(getattr(permissions, key) for key in required):
            await result("The bot needs View Channel, Send Messages, Embed Links and Attach Files in the FAQ channel.")
            return
        with closing(discord.File(image, filename=image.name)) as attachment:
            message = await channel.send(embed=embed, file=attachment, allowed_mentions=mentions)
    except discord.Forbidden:
        await result("Discord denied access to the FAQ channel. Check the bot's channel permissions.")
        return
    except discord.HTTPException:
        await result("Discord could not confirm publication. Check the FAQ channel before retrying.")
        return
    # Publication has already succeeded; a confirmation failure must not retry it.
    await result(f"FAQ published: {message.jump_url}")


def register_faq_command(tree):
    @tree.command(name="faqpost", description="Preview the updated MindoAI FAQ; publication is disabled by default")
    @discord.app_commands.default_permissions(manage_messages=True)
    @discord.app_commands.guild_only()
    @discord.app_commands.describe(publish="Explicitly post to the configured FAQ channel, when publishing is enabled")
    async def faqpost(interaction: discord.Interaction, publish: bool = False):
        await handle_faq_command(interaction, publish=publish)

    return faqpost


def export_preview(destination):
    """Write a portable HTML preview and Discord payload without network requests."""
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    embed, image = build_faq()
    payload = {
        "publication_enabled": False,
        "target_guild_id": str(FAQSettings.guild_id),
        "target_channel_id": str(FAQSettings.channel_id),
        "message": {"embeds": [embed.to_dict()], "allowed_mentions": {"parse": []}},
        "files": [{"filename": image.name, "path": str(image)}],
    }
    (destination / "faq-payload.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    paragraphs = []
    for paragraph in embed.description.split("\n\n"):
        escaped = html.escape(paragraph)
        escaped = re.sub(r"\*\*(.*?)\*\*", r"<strong>\1</strong>", escaped)
        paragraphs.append("<p>" + escaped.replace("\n", "<br>") + "</p>")
    image_data = base64.b64encode(image.read_bytes()).decode("ascii")
    document = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MindoAI FAQ preview</title><style>
*{box-sizing:border-box}body{margin:0;padding:28px 20px;background:#313338;color:#f2f3f5;font:16px/1.5 Arial,sans-serif}
main{max-width:580px;margin:auto}.status{font-size:13px;color:#b5bac1;margin-bottom:14px}
article{padding:18px 18px 18px 15px;border-left:4px solid #00ff99;border-radius:4px;background:#2b2d31}
h1{font-size:19px;line-height:1.35;margin:0 0 16px}p{margin:0 0 16px}p:last-of-type{margin-bottom:20px}
img{display:block;width:100%;height:auto;border-radius:4px}strong{font-weight:700}
</style><main><div class="status">Local preview · Nothing has been published to Discord</div><article>
<h1>""" + html.escape(embed.title) + "</h1>" + "".join(paragraphs) + '<img alt="MindoAI FAQ artwork" src="data:image/png;base64,' + image_data + '"></article></main></html>'
    preview = destination / "faq-preview.html"
    preview.write_text(document, encoding="utf-8")
    return preview


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export the FAQ preview locally; this command cannot send messages.")
    parser.add_argument("--preview-dir", type=Path, required=True)
    arguments = parser.parse_args()
    print(export_preview(arguments.preview_dir))
