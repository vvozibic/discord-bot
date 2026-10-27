import { createPublicKey, verify } from 'node:crypto';
import { createBotStore } from './store.js';
import { createDiscordRest } from './rest.js';
import { postSupportCard, updateSupportCard, setTicketPanelSuppressed } from './support.js';

const SNOWFLAKE = /^\d{15,22}$/;
const NO_MENTIONS = { parse:[], users:[], roles:[], replied_user:false };
const PRIVATE = 64;
const text = value => String(value ?? '').replace(/[\r\n]/g, ' ').replace(/[\\`*_~|<>@\[\]]/g, '').slice(0, 80);
const message = (content, extra = {}) => ({ type:4, data:{ content, flags:PRIVATE, allowed_mentions:NO_MENTIONS, ...extra } });
const buttons = () => [{ type:1, components:[
  { type:2, style:3, label:'Play Forest Trail', custom_id:'trail:play' },
  { type:2, style:1, label:'Join campaign', custom_id:'trail:join' },
  { type:2, style:2, label:'Ranking', custom_id:'trail:ranking' },
  { type:2, style:2, label:'Support', custom_id:'trail:support' },
] }];

function canManageGuild(interaction) {
  try { return (BigInt(interaction.member?.permissions ?? '0') & (32n | 8n)) !== 0n; }
  catch { return false; }
}

function isAdministrator(interaction) {
  const permissions = interaction.member?.permissions;
  if (typeof permissions !== 'string' || !/^\d+$/.test(permissions)) return false;
  try { return (BigInt(permissions) & 8n) !== 0n; }
  catch { return false; }
}

export function verifyDiscordRequest(publicKey, signature, timestamp, body, now = Date.now()) {
  if (!/^[\da-f]{64}$/i.test(publicKey) || !/^[\da-f]{128}$/i.test(signature ?? '') || !/^\d{10}$/.test(timestamp ?? '')) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  try {
    const key = createPublicKey({ key:Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'hex')]), format:'der', type:'spki' });
    return verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signature, 'hex'));
  } catch { return false; }
}

export function createDiscordBot({ db, store:providedStore, clientId = '', publicKey = '', token = '', guildId = '', eventId = 'tag',
  eventName = 'TAG campaign', supportChannelId = '', ticketToolApplicationId = '', testChannelId = '', readRanking,
  now = Date.now, rest = createDiscordRest({ token }), onError = () => console.error('Discord bot operation failed; check bot configuration and permissions.') } = {}) {
  const store = providedStore ?? createBotStore(db, { eventId, now });
  const testMode = testChannelId !== '';
  const supportTarget = testMode ? testChannelId : supportChannelId;
  const configured = SNOWFLAKE.test(clientId) && SNOWFLAKE.test(guildId) && /^[\da-f]{64}$/i.test(publicKey)
    && (!testMode || (typeof testChannelId === 'string' && SNOWFLAKE.test(testChannelId)));
  const pending = new Set(), requests = new Set(), inFlight = new Map(), buckets = new Map();
  async function ranking(interaction, profileOnly = false) {
    const userId = interaction.member.user.id;
    const board = await readRanking(interaction.guild_id, userId);
    const own = board.you;
    const lines = profileOnly ? [] : board.rows.slice(0, 10).map(row => `**${row.rank}. ${text(row.name) || 'Player'}** — level ${row.level} · ${row.score} pts`);
    if (!profileOnly && !lines.length) lines.push('No verified results yet. Complete a ranked level to appear here.');
    if (profileOnly) lines.push(await store.participant(interaction.guild_id, userId) ? 'You have joined this campaign.' : 'Use /participate to join this campaign.');
    lines.push(own ? `\nYour verified result: **#${own.rank}** · level ${own.level} · ${own.score} pts` : '\nYou have no verified wins yet. Launch the game and connect your Discord profile.');
    return message('', { embeds:[{ title:`Forest Trail · ${profileOnly ? 'your participation' : 'server ranking'}`,
      description:lines.join('\n'), color:0x64b484, footer:{ text:`${text(eventName)} · verified wins: ${board.total}` } }], components:buttons() });
  }
  async function join(interaction) {
    const user = interaction.member.user;
    await store.join(interaction.guild_id, { id:user.id, name:interaction.member.nick || user.global_name || user.username });
    return message(`You’re registered for **${text(eventName)}**. Play Forest Trail and connect your Discord profile to submit verified runs. Joining alone does not add a score.`, { components:buttons() });
  }
  function support() {
    return message(SNOWFLAKE.test(supportTarget)
      ? `Open <#${supportTarget}> and use Ticket Tool’s **Create ticket** button. Ticket Tool handles your ticket.`
      : 'The support channel has not been configured yet. Ask a server administrator to set DISCORD_SUPPORT_CHANNEL_ID.');
  }
  async function publishGamePanel(interaction) {
    const channel = await rest.request('GET', `/channels/${interaction.channel_id}`);
    if (channel.guild_id !== interaction.guild_id || channel.type !== 0) throw new Error('Run game-panel in a text channel in this server.');
    const panel = await rest.request('POST', `/channels/${interaction.channel_id}/messages`, {
      embeds:[{ title:'Forest Trail', description:`Join **${text(eventName)}**, collect six coins, and reach the portal.\nConnect your Discord profile in the game to enter this server’s verified ranking.`, color:0x64b484 }],
      components:buttons(), allowed_mentions:NO_MENTIONS,
    });
    return `Game panel published: https://discord.com/channels/${guildId}/${interaction.channel_id}/${panel.id}`;
  }
  function setup(interaction) {
    if (!canManageGuild(interaction)) return { response:message('Manage Server permission is required to configure panels.') };
    if (!SNOWFLAKE.test(interaction.channel_id ?? '')) return { response:message('Use this command in a server text channel.') };
    if (!/^[\w.-]{1,300}$/.test(interaction.token ?? '')) return { response:message('This command is missing its Discord response token. Try again.') };
    const command = interaction.data.options?.[0];
    const options = Object.fromEntries((command?.options ?? []).map(option => [option.name, option.value]));
    const channelId = supportTarget || interaction.channel_id;
    const common = { rest, guildId:interaction.guild_id, channelId };
    const content = { title:options.title || 'Support', description:options.text, imageUrl:options.image };
    let operation;
    if (command?.name === 'game-panel') operation = () => publishGamePanel(interaction);
    else if (command?.name === 'support-card') operation = async () => {
      const result = await postSupportCard({ ...common, content });
      return `Support card posted: https://discord.com/channels/${guildId}/${channelId}/${result.wrapperMessageId}\nNow post Ticket Tool’s authentic panel below it, then run /bot-setup support-hide with that panel’s message ID.`;
    };
    else if (command?.name === 'support-update') operation = async () => {
      await updateSupportCard({ ...common, wrapperMessageId:options.message, clientId, content });
      return 'Support card updated.';
    };
    else if (['support-hide','support-restore'].includes(command?.name)) operation = async () => {
      const suppressed = command.name === 'support-hide';
      await setTicketPanelSuppressed({ ...common, ticketMessageId:options.message, ticketToolApplicationId, suppressed });
      return suppressed ? 'Ticket Tool’s embed is hidden. Its original ticket button is preserved.' : 'Ticket Tool’s embed is restored.';
    };
    else return { response:message('Choose a supported /bot-setup subcommand.') };
    return { response:{ type:5, data:{ flags:PRIVATE } }, after:async () => {
      let content;
      try { content = await operation(); }
      catch (error) {
        // Never include HTTP response bodies, interaction tokens, or credentials in a reply.
        onError();
        content = error?.name === 'SupportValidationError' ? error.message : 'The panel could not be updated. Check the channel/message IDs, configured Ticket Tool ID, and the bot’s View Channel, Send Messages, Embed Links, Read Message History and Manage Messages permissions.';
      }
      await rest.request('PATCH', `/webhooks/${clientId}/${interaction.token}/messages/@original`, { content, allowed_mentions:NO_MENTIONS }, { webhook:true });
    } };
  }
  async function dispatch(interaction) {
    const command = interaction.type === 3 ? interaction.data?.custom_id : interaction.data?.name;
    if (interaction.type !== 2 && interaction.type !== 3) return { response:message('Use a Forest Trail slash command or button.') };
    if (interaction.type === 2 && interaction.data?.type === 4) {
      await join(interaction);
      return { response:{ type:12 } };
    }
    if (command === 'bot-setup' && interaction.type === 2) return setup(interaction);
    if (['play','trail:play'].includes(command)) {
      await join(interaction);
      return { response:{ type:12 } };
    }
    if (['participate','trail:join'].includes(command)) return { response:await join(interaction) };
    if (['trail-ranking','trail:ranking'].includes(command)) return { response:await ranking(interaction) };
    if (command === 'trail-profile') return { response:await ranking(interaction, true) };
    if (['support','trail:support'].includes(command)) return { response:support() };
    return { response:message('Use /play, /participate, /trail-ranking, /trail-profile or /support.') };
  }
  function send(response, status, data) {
    response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
    response.end(JSON.stringify(data));
  }
  async function dispatchOnce(interaction) {
    const previous = inFlight.get(interaction.id);
    if (previous) return { response:(await previous).response };
    const job = (async () => {
      const cached = await store.cachedInteraction(interaction.id);
      if (cached) return { response:cached };
      const key = interaction.member.user.id, time = now();
      if (buckets.size > 5000) for (const [id, bucket] of buckets) if (bucket.until <= time) buckets.delete(id);
      let bucket = buckets.get(key);
      if (!bucket || bucket.until <= time) buckets.set(key, bucket = { until:time + 60000, count:0 });
      const result = ++bucket.count > 30 ? { response:message('Please wait a moment before trying again.') } : await dispatch(interaction);
      await store.cacheInteraction(interaction.id, result.response);
      return result;
    })();
    inFlight.set(interaction.id, job);
    try { return await job; }
    finally { inFlight.delete(interaction.id); }
  }
  async function handleRequest(request, response) {
    if (request.method !== 'POST') { send(response, 405, { error:'POST required' }); return; }
    if (!configured) { send(response, 503, { error:'Discord bot is not configured' }); return; }
    try {
      const chunks = []; let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 128 * 1024) { send(response, 413, { error:'Request is too large' }); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (!verifyDiscordRequest(publicKey, request.headers['x-signature-ed25519'], request.headers['x-signature-timestamp'], body, now())) {
        send(response, 401, { error:'Invalid signature' }); return;
      }
      let interaction;
      try { interaction = JSON.parse(body.toString('utf8')); } catch { send(response, 400, { error:'Invalid JSON' }); return; }
      if (!interaction || interaction.application_id !== clientId) { send(response, 403, { error:'Wrong Discord application' }); return; }
      if (interaction.type === 1) { send(response, 200, { type:1 }); return; }
      if (testMode && (interaction.channel_id !== testChannelId || !isAdministrator(interaction))) {
        send(response, 200, message('Admin test mode: this bot is restricted to administrators in its configured test channel.')); return;
      }
      if (interaction.guild_id !== guildId || !SNOWFLAKE.test(interaction.member?.user?.id ?? '') || !SNOWFLAKE.test(interaction.id ?? '')) {
        send(response, 200, message('This bot is available only in its configured server.')); return;
      }
      const result = await dispatchOnce(interaction);
      send(response, 200, result.response);
      if (result.after) {
        const task = Promise.resolve().then(result.after).catch(() => onError()).finally(() => pending.delete(task));
        pending.add(task);
      }
    } catch {
      onError();
      if (!response.headersSent) send(response, 500, { error:'The bot is temporarily unavailable' });
    }
  }
  function handle(request, response) {
    const work = handleRequest(request, response);
    requests.add(work);
    return work.finally(() => requests.delete(work));
  }
  return { handle, configured, get pendingCount() { return pending.size + requests.size; },
    async whenIdle() { while (pending.size || requests.size) await Promise.allSettled([...pending, ...requests]); } };
}
