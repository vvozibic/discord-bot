const SNOWFLAKE = /^\d{15,22}$/;
const SUPPRESS_EMBEDS = 4n;

export class SupportValidationError extends Error {
  name = 'SupportValidationError';
}

function snowflake(value, label) {
  if (typeof value !== 'string' || !SNOWFLAKE.test(value)) throw new SupportValidationError(`${label} must be a Discord ID`);
  return value;
}

function connection(rest, guildId, channelId) {
  if (typeof rest?.request !== 'function') throw new SupportValidationError('Discord REST client is required');
  snowflake(guildId, 'Server ID');
  snowflake(channelId, 'Channel ID');
}

async function verifyChannel(rest, guildId, channelId) {
  const channel = await rest.request('GET', `/channels/${channelId}`);
  if (channel?.id !== channelId || channel.guild_id !== guildId || channel.type !== 0) {
    throw new SupportValidationError('Support panels require a text channel in the configured server');
  }
}

function text(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new SupportValidationError(`${label} must contain 1–${limit} characters without control characters`);
  }
  return value.trim();
}

function imageAttachment(value) {
  if (value == null) return null;
  const types = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp' };
  if (typeof value !== 'object' || typeof value.filename !== 'string' || value.filename.length > 100
    || !/^[a-z0-9][a-z0-9._-]*\.(png|jpe?g|gif|webp)$/i.test(value.filename)) {
    throw new SupportValidationError('Support attachment needs a simple PNG, JPEG, GIF or WebP filename');
  }
  const type = types[value.filename.split('.').at(-1).toLowerCase()];
  if (value.contentType != null && value.contentType !== type) throw new SupportValidationError('Support attachment content type must match its image filename');
  if (!(value.data instanceof Uint8Array) || value.data.byteLength < 12 || value.data.byteLength > 20 * 1024 * 1024) {
    throw new SupportValidationError('Support attachment must contain image bytes and be no larger than 20 MiB');
  }
  const data = value.data;
  const matches = (start, bytes) => bytes.every((byte, index) => data[start + index] === byte);
  const validImage = type === 'image/png' ? matches(0, [137,80,78,71,13,10,26,10])
    : type === 'image/jpeg' ? matches(0, [255,216,255])
      : type === 'image/gif' ? matches(0, [71,73,70,56]) && [55,57].includes(data[4]) && data[5] === 97
        : matches(0, [82,73,70,70]) && matches(8, [87,69,66,80]);
  if (!validImage) throw new SupportValidationError('Support attachment bytes must match its image format');
  return { filename:value.filename, contentType:type, data };
}

/** Build an embed only; send it with allowed_mentions disabled (as below). */
export function supportEmbed(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw new SupportValidationError('Support content is required');
  const embed = {
    title:text(content.title ?? 'Support', 'Support title', 256),
    description:text(content.description, 'Support description', 4096),
    color:0x00ff99,
  };
  const attachment = imageAttachment(content.imageAttachment);
  if (attachment && content.imageUrl) throw new SupportValidationError('Choose either a support image URL or an uploaded image');
  if (attachment) embed.image = { url:`attachment://${attachment.filename}` };
  if (content.imageUrl != null && content.imageUrl !== '') {
    if (typeof content.imageUrl !== 'string' || content.imageUrl.length > 2048) throw new SupportValidationError('Support image must be an HTTPS URL');
    let image;
    try { image = new URL(content.imageUrl); } catch { throw new SupportValidationError('Support image must be an HTTPS URL'); }
    if (image.protocol !== 'https:' || !image.hostname || image.username || image.password) {
      throw new SupportValidationError('Support image must be an HTTPS URL without credentials');
    }
    embed.image = { url:image.href };
  }
  return embed;
}

function cardPayload(content, { update = false } = {}) {
  const payload = {
    embeds:[supportEmbed(content)],
    allowed_mentions:{ parse:[], users:[], roles:[], replied_user:false },
  };
  const attachment = imageAttachment(content.imageAttachment);
  if (!attachment) {
    // An edit replaces the card image completely, including any older upload.
    if (update) payload.attachments = [];
    return payload;
  }
  // API v10 requires every retained/new attachment in this array. Keeping only
  // placeholder 0 replaces the previous upload instead of accumulating files.
  payload.attachments = [{ id:0, filename:attachment.filename }];
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([attachment.data], { type:attachment.contentType }), attachment.filename);
  return form;
}

function verifyMessage(message, channelId, messageId) {
  if (message?.id !== messageId || message.channel_id !== channelId) throw new SupportValidationError('Discord returned an unexpected message');
}

/** Publish this card before asking Ticket Tool to publish its authentic panel.
 * Discord cannot insert a new message above an existing one or move that panel.
 */
export async function postSupportCard({ rest, guildId, channelId, content }) {
  connection(rest, guildId, channelId);
  const body = cardPayload(content);
  await verifyChannel(rest, guildId, channelId);
  const message = await rest.request('POST', `/channels/${channelId}/messages`, body);
  snowflake(message?.id, 'Published message ID');
  verifyMessage(message, channelId, message.id);
  return { guildId, channelId, wrapperMessageId:message.id };
}

/** Update our existing card in place; never edit another application's copy. */
export async function updateSupportCard({ rest, guildId, channelId, wrapperMessageId, clientId, content }) {
  connection(rest, guildId, channelId);
  snowflake(wrapperMessageId, 'Support card message ID');
  snowflake(clientId, 'Bot application ID');
  const body = cardPayload(content, { update:true });
  await verifyChannel(rest, guildId, channelId);
  const path = `/channels/${channelId}/messages/${wrapperMessageId}`;
  const original = await rest.request('GET', path);
  verifyMessage(original, channelId, wrapperMessageId);
  if (original.author?.id !== clientId || original.webhook_id) throw new SupportValidationError('Only this bot’s own support cards can be updated');
  await rest.request('PATCH', path, body);
  return { guildId, channelId, wrapperMessageId };
}

/** Toggle only SUPPRESS_EMBEDS on the explicit, authentic Ticket Tool message.
 * The message's content/components may be hidden without Message Content Intent.
 * We neither inspect nor replace them. Ticket Tool keeps ownership of its button.
 * https://docs.discord.com/developers/resources/message#edit-message
 */
export async function setTicketPanelSuppressed({ rest, guildId, channelId, ticketMessageId, ticketToolApplicationId, suppressed = true }) {
  connection(rest, guildId, channelId);
  snowflake(ticketMessageId, 'Ticket Tool message ID');
  snowflake(ticketToolApplicationId, 'Ticket Tool application ID');
  if (typeof suppressed !== 'boolean') throw new SupportValidationError('Suppressed must be a boolean');
  await verifyChannel(rest, guildId, channelId);
  const path = `/channels/${channelId}/messages/${ticketMessageId}`;
  const original = await rest.request('GET', path);
  verifyMessage(original, channelId, ticketMessageId);
  const fromBot = !original.webhook_id && original.author?.bot === true && original.author.id === ticketToolApplicationId;
  const fromApplicationWebhook = Boolean(original.webhook_id) && original.application_id === ticketToolApplicationId;
  if ((!fromBot && !fromApplicationWebhook)
    || (original.application_id != null && original.application_id !== ticketToolApplicationId)) {
    throw new SupportValidationError('The message does not belong to the configured Ticket Tool application');
  }
  const previous = original.flags ?? 0;
  if (!Number.isSafeInteger(previous) || previous < 0) throw new SupportValidationError('Discord returned invalid message flags');
  const flags = Number(suppressed ? BigInt(previous) | SUPPRESS_EMBEDS : BigInt(previous) & ~SUPPRESS_EMBEDS);
  if (flags !== previous) await rest.request('PATCH', path, { flags });
  return { guildId, channelId, ticketMessageId, suppressed, flags };
}
