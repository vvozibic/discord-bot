import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { openDatabase } from '../server/database.js';
import { createDiscordBot } from '../server/bot/interactions.js';

const CLIENT = '1556624227212460092';
const GUILD = '333333333333333333';
const USER = '123456789012345678';
const OTHER_USER = '223456789012345678';
const CHANNEL = '433333333333333333';
const SUPPORT_CHANNEL = '533333333333333333';
const PANEL_MESSAGE = '633333333333333333';
const NO_MENTIONS = { parse:[], users:[], roles:[], replied_user:false };
let sequence = 0;

function interaction(command, extra = {}) {
  return {
    id:String(900000000000000000n + BigInt(++sequence)), application_id:CLIENT,
    type:2, guild_id:GUILD, channel_id:CHANNEL,
    member:{ permissions:'0', nick:'Server Alice', user:{ id:USER, username:'alice' } },
    data:{ name:command }, ...extra,
  };
}

async function fixture(options = {}) {
  const db = openDatabase(':memory:');
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ format:'der', type:'spki' }).subarray(-32).toString('hex');
  const calls = [], rankingCalls = [];
  let time = 1800000000000;
  const rest = { async request(method, path, body, requestOptions) {
    calls.push({ method, path, body, options:requestOptions });
    if (method === 'GET' && /^\/channels\/\d+$/.test(path)) return { id:path.split('/').at(-1), guild_id:GUILD, type:0 };
    if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(path)) return { id:PANEL_MESSAGE, channel_id:path.split('/')[2] };
    if (method === 'PATCH' && path.startsWith('/webhooks/')) return { id:'733333333333333333' };
    throw new Error(`Unexpected fake REST request: ${method} ${path}`);
  } };
  const bot = createDiscordBot({ db, clientId:CLIENT, publicKey, guildId:GUILD,
    supportChannelId:SUPPORT_CHANNEL, token:'server-only-test-bot-token', now:() => time,
    readRanking:(guildId, userId) => {
      rankingCalls.push({ guildId, userId });
      return { rows:[], you:null, total:0 };
    }, rest, onError:() => {}, ...options });
  const server = createServer((request, response) => bot.handle(request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/discord/interactions`;
  async function send(value, requestOptions = {}) {
    const body = Buffer.from(requestOptions.body ?? JSON.stringify(value));
    const timestamp = requestOptions.timestamp ?? String(Math.floor(time / 1000));
    const signedBody = requestOptions.signedBody == null ? body : Buffer.from(requestOptions.signedBody);
    const signature = requestOptions.signature ?? sign(null, Buffer.concat([Buffer.from(timestamp), signedBody]), keys.privateKey).toString('hex');
    const response = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json',
      'X-Signature-Ed25519':signature, 'X-Signature-Timestamp':timestamp }, body });
    return { status:response.status, body:await response.json() };
  }
  return { db, bot, send, calls, rankingCalls,
    tick(milliseconds) { time += milliseconds; },
    timestamp(offsetSeconds = 0) { return String(Math.floor(time / 1000) + offsetSeconds); },
    async close() {
      await bot.whenIdle();
      await new Promise(resolve => server.close(resolve));
      db.close();
    } };
}

test('real Ed25519 signatures reject invalid, tampered, stale and future requests', async () => {
  const f = await fixture();
  try {
    const ping = { type:1, application_id:CLIENT };
    assert.equal((await f.send(ping, { signature:'00'.repeat(64) })).status, 401);
    assert.equal((await f.send(ping, { signature:'not-a-signature' })).status, 401);
    assert.equal((await f.send(ping, { signedBody:JSON.stringify({ ...ping, type:2 }) })).status, 401);
    assert.equal((await f.send(ping, { timestamp:f.timestamp(-301) })).status, 401);
    assert.equal((await f.send(ping, { timestamp:f.timestamp(301) })).status, 401);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_interaction_cache').get().count, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 0);
  } finally { await f.close(); }
});

test('a signed application ping succeeds and another application is rejected', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.send({ type:1, application_id:CLIENT }), { status:200, body:{ type:1 } });
    assert.equal((await f.send({ type:1, application_id:'2556624227212460092' })).status, 403);
    assert.equal((await f.send({ type:1 })).status, 403);
  } finally { await f.close(); }
});

test('commands from another guild or direct messages cannot register or cache participants', async () => {
  const f = await fixture();
  try {
    const wrongGuild = interaction('participate', { guild_id:'444444444444444444' });
    const dm = interaction('participate');
    delete dm.guild_id;
    delete dm.member;
    dm.user = { id:USER, username:'alice' };
    for (const value of [wrongGuild, dm]) {
      const result = await f.send(value);
      assert.equal(result.status, 200);
      assert.equal(result.body.type, 4);
      assert.equal(result.body.data.flags, 64);
      assert.match(result.body.data.content, /configured server/);
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_interaction_cache').get().count, 0);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('/participate and the join button persist one participant per campaign', async () => {
  const f = await fixture();
  try {
    const first = await f.send(interaction('participate'));
    assert.equal(first.status, 200);
    assert.equal(first.body.type, 4);
    assert.equal(first.body.data.flags, 64);
    assert.deepEqual(first.body.data.allowed_mentions, NO_MENTIONS);
    assert.match(first.body.data.content, /registered/);
    const before = { ...f.db.prepare('SELECT * FROM bot_participants').get() };
    f.tick(1000);
    const joined = await f.send(interaction(undefined, { type:3, data:{ custom_id:'trail:join' } }));
    assert.equal(joined.status, 200);
    assert.match(joined.body.data.content, /Joining alone does not add a score/);
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM bot_participants').get() }, before);
    assert.equal(before.guild_id, GUILD);
    assert.equal(before.user_id, USER);
    assert.equal(before.name, 'Server Alice');
    assert.equal(before.event_id, 'tag');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 0);
  } finally { await f.close(); }
});

test('/play and its button launch the Activity using callback type 12', async () => {
  const f = await fixture();
  try {
    for (const value of [interaction('play'), interaction(undefined, { type:3, data:{ custom_id:'trail:play' } })]) {
      assert.deepEqual(await f.send(value), { status:200, body:{ type:12 } });
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 1);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('the application-handled Activity entry point launches by command type and persists participation', async () => {
  const f = await fixture();
  try {
    for (const name of ['Launch', 'Custom activity name']) {
      assert.deepEqual(await f.send(interaction(name, { data:{ name, type:4 } })), { status:200, body:{ type:12 } });
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 1);
    assert.equal(f.db.prepare('SELECT user_id FROM bot_participants').get().user_id, USER);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('ranking derives guild and player IDs from the signed member and disables mentions', async () => {
  const rankings = [];
  const f = await fixture({ eventName:'@everyone **Campaign**', readRanking:(guildId, userId) => {
    rankings.push({ guildId, userId });
    return { rows:[{ rank:1, name:'@everyone\n[click](https://evil.example) <@123> **name**', level:3, score:1300 }],
      you:{ userId:USER, rank:1, level:3, score:1300 }, total:1 };
  } });
  try {
    const result = await f.send(interaction('trail-ranking', { data:{ name:'trail-ranking', options:[
      { name:'guildId', value:'444444444444444444' }, { name:'userId', value:OTHER_USER },
    ] } }));
    assert.equal(result.status, 200);
    assert.deepEqual(rankings, [{ guildId:GUILD, userId:USER }]);
    assert.deepEqual(result.body.data.allowed_mentions, NO_MENTIONS);
    assert.equal(result.body.data.flags, 64);
    const embed = result.body.data.embeds[0];
    assert.doesNotMatch(embed.description, /@|\[click\]|<@|\*\*name\*\*/);
    assert.doesNotMatch(embed.footer.text, /@|\*\*/);
    assert.match(embed.description, /level 3 · 1300 pts/);
    assert.match(embed.description, /Your verified result/);
    const button = await f.send(interaction(undefined, { type:3, data:{ custom_id:'trail:ranking' } }));
    assert.equal(button.status, 200);
    assert.equal(rankings.length, 2);
    assert.deepEqual(rankings[1], { guildId:GUILD, userId:USER });
  } finally { await f.close(); }
});

test('/trail-profile distinguishes campaign registration from a verified win', async () => {
  const f = await fixture();
  try {
    const before = await f.send(interaction('trail-profile'));
    assert.match(before.body.data.embeds[0].description, /Use \/participate to join/);
    assert.match(before.body.data.embeds[0].description, /no verified wins yet/);
    await f.send(interaction('participate'));
    const after = await f.send(interaction('trail-profile'));
    assert.match(after.body.data.embeds[0].description, /You have joined this campaign/);
    assert.match(after.body.data.embeds[0].description, /no verified wins yet/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 0);
    assert.deepEqual(f.rankingCalls, [{ guildId:GUILD, userId:USER }, { guildId:GUILD, userId:USER }]);
  } finally { await f.close(); }
});

test('/support and its button direct participants to Ticket Tool in the configured channel', async () => {
  const f = await fixture();
  try {
    for (const value of [interaction('support'), interaction(undefined, { type:3, data:{ custom_id:'trail:support' } })]) {
      const result = await f.send(value);
      assert.equal(result.status, 200);
      assert.match(result.body.data.content, new RegExp(`<#${SUPPORT_CHANNEL}>`));
      assert.match(result.body.data.content, /Ticket Tool/);
      assert.deepEqual(result.body.data.allowed_mentions, NO_MENTIONS);
    }
    assert.equal(f.calls.length, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 0);
  } finally { await f.close(); }
});

test('/bot-setup without Manage Server permission performs no Discord REST request', async () => {
  const f = await fixture();
  try {
    const result = await f.send(interaction('bot-setup', { token:'test-interaction-token',
      data:{ name:'bot-setup', options:[{ type:1, name:'game-panel' }] } }));
    assert.equal(result.status, 200);
    assert.equal(result.body.type, 4);
    assert.match(result.body.data.content, /Manage Server permission is required/);
    await f.bot.whenIdle();
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('authorized setup defers privately and edits its webhook response once across retries', async () => {
  const f = await fixture();
  try {
    const command = interaction('bot-setup', {
      token:'test-interaction-token',
      member:{ permissions:'32', user:{ id:USER, username:'alice' } },
      data:{ name:'bot-setup', options:[{ type:1, name:'support-card', options:[
        { name:'text', value:'Please create a ticket below.' },
        { name:'image', value:'https://example.com/support.png' },
      ] }] },
    });
    const results = await Promise.all([f.send(command), f.send(command)]);
    for (const result of results) assert.deepEqual(result, { status:200, body:{ type:5, data:{ flags:64 } } });
    await f.bot.whenIdle();
    assert.equal(f.bot.pendingCount, 0);
    assert.equal(f.calls.length, 3);
    assert.deepEqual(f.calls[0], { method:'GET', path:`/channels/${SUPPORT_CHANNEL}`, body:undefined, options:undefined });
    const published = f.calls[1];
    assert.equal(published.method, 'POST');
    assert.equal(published.path, `/channels/${SUPPORT_CHANNEL}/messages`);
    assert.equal(published.body.embeds[0].description, 'Please create a ticket below.');
    assert.deepEqual(published.body.embeds[0].image, { url:'https://example.com/support.png' });
    assert.deepEqual(published.body.allowed_mentions, NO_MENTIONS);
    assert.equal('components' in published.body, false, 'our card must not recreate Ticket Tool buttons');
    const followup = f.calls[2];
    assert.equal(followup.method, 'PATCH');
    assert.equal(followup.path, `/webhooks/${CLIENT}/${command.token}/messages/@original`);
    assert.deepEqual(followup.options, { webhook:true }, 'webhook requests must bypass Bot authorization');
    assert.deepEqual(followup.body.allowed_mentions, NO_MENTIONS);
    assert.match(followup.body.content, new RegExp(PANEL_MESSAGE));
    assert.doesNotMatch(JSON.stringify(f.calls), /server-only-test-bot-token/);
    await f.send(command);
    await f.bot.whenIdle();
    assert.equal(f.calls.length, 3, 'a replayed signed interaction must not publish another card');
  } finally { await f.close(); }
});

test('signed malformed JSON and oversized request bodies are rejected', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.send(null, { body:'{"type":1,' })).status, 400);
    assert.equal((await f.send(null, { body:'x'.repeat(128 * 1024 + 1) })).status, 413);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_interaction_cache').get().count, 0);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
