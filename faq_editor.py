"""Edit a static FAQ posted by this bot through Discord's own message UI."""

import asyncio
from contextlib import closing
from io import BytesIO
import re
from urllib.parse import urlsplit

import discord

from faq_announcement import FAQSettings


_EDIT_LOCKS = {}
_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024


async def _reply(interaction, text):
    send = interaction.followup.send if interaction.response.is_done() else interaction.response.send_message
    await send(text, ephemeral=True, allowed_mentions=discord.AllowedMentions.none())


def _scope(interaction, settings=None):
    settings = settings or FAQSettings.from_env()
    if interaction.guild is None or interaction.guild_id != settings.guild_id:
        raise ValueError("This FAQ editor is available in the Mindo AI server only.")
    if not interaction.permissions.manage_messages:
        raise ValueError("You need Manage Messages permission to edit the FAQ.")
    if not settings.publish_enabled:
        raise ValueError("Public FAQ changes are disabled. No message was edited.")
    return settings


def parse_message_id(value, settings):
    value = value.strip()
    if not value.isascii() or not value.isdigit():
        url = urlsplit(value)
        if url.scheme != "https" or url.netloc not in {"discord.com", "ptb.discord.com", "canary.discord.com", "discordapp.com"}:
            raise ValueError("Use a Discord FAQ message link or message ID.")
        match = re.fullmatch(r"/channels/([0-9]+)/([0-9]+)/([0-9]+)/?", url.path)
        if match is None:
            raise ValueError("Use a Discord FAQ message link or message ID.")
        guild_id, channel_id, value = match.groups()
        if int(guild_id) != settings.guild_id or int(channel_id) != settings.channel_id:
            raise ValueError("The message link must point to the configured FAQ channel.")
    if not 0 < int(value) < 2**64:
        raise ValueError("The message ID is invalid.")
    return int(value)


async def _channel(interaction, settings):
    channel = interaction.guild.get_channel(settings.channel_id)
    if channel is None:
        channel = await interaction.guild.fetch_channel(settings.channel_id)
    if not isinstance(channel, discord.TextChannel) or channel.guild.id != settings.guild_id:
        raise ValueError("The FAQ destination must be a text channel in this server.")
    if not channel.permissions_for(interaction.user).manage_messages:
        raise ValueError("You need Manage Messages permission in the FAQ channel.")
    member = interaction.guild.me
    permissions = channel.permissions_for(member) if member is not None else None
    if permissions is None or not all(getattr(permissions, name) for name in ("view_channel", "read_message_history", "embed_links")):
        raise ValueError("The bot needs View Channel, Read Message History and Embed Links in the FAQ channel.")
    return channel


def _validate_message(message, interaction, settings):
    bot = interaction.client.user
    if message.channel.id != settings.channel_id or message.guild.id != settings.guild_id:
        raise ValueError("Choose a message in the configured FAQ channel.")
    if bot is None or message.author.id != bot.id or message.webhook_id is not None:
        raise ValueError("This message belongs to another bot. Choose the new FAQ posted by this bot.")
    if len(message.embeds) != 1 or message.components:
        raise ValueError("Choose the static FAQ message, not an interactive panel.")


def _version(message):
    # Reactions do not form part of the editable document and never invalidate it.
    return (message.edited_at, message.embeds[0].to_dict(), tuple(item.id for item in message.attachments))


def _validate_image(image):
    if image is not None and (image.content_type not in _IMAGE_TYPES or image.size > MAX_IMAGE_BYTES):
        raise ValueError("Choose a PNG, JPEG, WebP or GIF image no larger than 8 MB.")


class FAQEditModal(discord.ui.Modal):
    def __init__(self, message, user_id, *, image=None, settings=None):
        super().__init__(title="Edit FAQ", timeout=300)
        self.message_id = message.id
        self.user_id = user_id
        self.image = image
        self.settings = settings
        self.version = _version(message)
        embed = message.embeds[0]
        self.faq_title = discord.ui.TextInput(label="FAQ title", default=embed.title or "FAQ", max_length=256)
        self.faq_text = discord.ui.TextInput(
            label="FAQ text (Discord Markdown)", style=discord.TextStyle.paragraph,
            default=embed.description or "", max_length=4000,
        )
        self.add_item(self.faq_title)
        self.add_item(self.faq_text)

    async def on_submit(self, interaction):
        try:
            if interaction.user.id != self.user_id:
                raise ValueError("Only the person who opened this editor can save it.")
            settings = _scope(interaction, self.settings)
            if not self.faq_title.value.strip() or not self.faq_text.value.strip():
                raise ValueError("The FAQ title and text cannot be empty.")
        except ValueError as error:
            await _reply(interaction, str(error))
            return

        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            async with _EDIT_LOCKS.setdefault(self.message_id, asyncio.Lock()):
                channel = await _channel(interaction, settings)
                message = await channel.fetch_message(self.message_id)
                _validate_message(message, interaction, settings)
                if _version(message) != self.version:
                    raise ValueError("The FAQ changed while this editor was open. Reopen Edit FAQ to avoid overwriting those changes.")
                embed = message.embeds[0].copy()
                embed.title = self.faq_title.value.strip()
                embed.description = self.faq_text.value.strip()
                if len(embed.title) > 256 or len(embed.description) > 4000 or len(embed) > 6000:
                    raise ValueError("The edited FAQ exceeds Discord's text limits.")
                kwargs = {"embed": embed, "allowed_mentions": discord.AllowedMentions.none()}
                if self.image is None:
                    # Omitting attachments preserves the current file and artwork.
                    await message.edit(**kwargs)
                else:
                    _validate_image(self.image)
                    if len(message.attachments) > 1:
                        raise ValueError("This message has multiple attachments. Image replacement was cancelled to preserve them.")
                    if not channel.permissions_for(interaction.guild.me).attach_files:
                        raise ValueError("The bot needs Attach Files permission to replace the FAQ image.")
                    data = await self.image.read()
                    if len(data) > MAX_IMAGE_BYTES:
                        raise ValueError("Choose an image no larger than 8 MB.")
                    filename = "mindo-faq-edited" + _IMAGE_TYPES[self.image.content_type]
                    embed.set_image(url=f"attachment://{filename}")
                    with BytesIO(data) as stream, closing(discord.File(stream, filename=filename)) as attachment:
                        await message.edit(**kwargs, attachments=[attachment])
        except ValueError as error:
            await _reply(interaction, str(error))
            return
        except discord.NotFound:
            await _reply(interaction, "The FAQ message no longer exists. Nothing was recreated.")
            return
        except discord.Forbidden:
            await _reply(interaction, "Discord denied access. Check the bot's FAQ channel permissions.")
            return
        except discord.HTTPException:
            await _reply(interaction, "Discord could not confirm the edit. Check the existing FAQ before retrying.")
            return
        await _reply(interaction, f"FAQ updated: {message.jump_url}")


async def open_faq_editor(interaction, reference, *, image=None, message=None, settings=None):
    try:
        effective = _scope(interaction, settings)
        message_id = parse_message_id(reference, effective)
        _validate_image(image)

        async def load():
            channel = await _channel(interaction, effective)
            return message if message is not None else await channel.fetch_message(message_id)

        # A modal must be the initial interaction response, within Discord's deadline.
        current = await asyncio.wait_for(load(), timeout=2)
        if current.id != message_id:
            raise ValueError("The selected message does not match the requested FAQ.")
        _validate_message(current, interaction, effective)
        if len(current.embeds[0].description or "") > 4000:
            raise ValueError("This message is too long for Discord's editing form.")
    except (ValueError, TimeoutError) as error:
        await _reply(interaction, str(error) or "The FAQ could not be loaded in time. Try opening the editor again.")
        return
    except discord.NotFound:
        await _reply(interaction, "The FAQ message was not found.")
        return
    except (discord.Forbidden, discord.HTTPException):
        await _reply(interaction, "The bot could not read that FAQ. Check its channel permissions.")
        return
    await interaction.response.send_modal(FAQEditModal(current, interaction.user.id, image=image, settings=settings))


def register_faq_editor(tree):
    @tree.command(name="faqedit", description="Edit this bot's existing FAQ without reposting it")
    @discord.app_commands.default_permissions(manage_messages=True)
    @discord.app_commands.guild_only()
    @discord.app_commands.describe(message="Link or ID of this bot's FAQ message", image="Optional replacement FAQ image")
    async def faqedit(interaction: discord.Interaction, message: str, image: discord.Attachment | None = None):
        await open_faq_editor(interaction, message, image=image)

    @tree.context_menu(name="Edit FAQ")
    @discord.app_commands.default_permissions(manage_messages=True)
    @discord.app_commands.guild_only()
    async def edit_faq_menu(interaction: discord.Interaction, message: discord.Message):
        await open_faq_editor(interaction, str(message.id), message=message)

    return faqedit, edit_faq_menu
