import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { openDatabase } from '../server/database.js';
import { createDiscordBot } from '../server/bot/interactions.js';
import { botOptionsFromEnv } from '../server/bot/config.js';

const CLIENT = '1556624227212460092', GUILD = '333333333333333333', USER = '123456789012345678';
const TEST_CHANNEL = '433333333333333333', LIVE_CHANNEL = '533333333333333333';
const CARD = '633333333333333333', TICKET = '733333333333333333', TICKET_TOOL = '833333333333333333';

async function fixture(options = {}) {
  const db = openDatabase(':memory:'), keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ format:'der', type:'spki' }).subarray(-32).toString('hex');
  const calls = [], rankingCalls = [];
  let sequence = 900000000000000000n;
  const now = () => 1800000000000;
  const rest = { async request(method, path, body) {
    calls.push({ method, path, body });
    if (method === 'GET' && /^\/channels\/\d+$/.test(path)) return { id:TEST_CHANNEL, guild_id:GUILD, type:0 };
    if (method === 'GET' && path.includes('/messages/')) {
      const id = path.split('/').at(-1);
      return { id, channel_id:TEST_CHANNEL, author:{ id:id === CARD ? CLIENT : TICKET_TOOL, bot:true }, flags:id === TICKET ? 4 : 0 };
    }
    if (method === 'POST') return { id:CARD, channel_id:TEST_CHANNEL };
    return {};
  } };
  const bot = createDiscordBot({ db, clientId:CLIENT, publicKey, guildId:GUILD, testChannelId:TEST_CHANNEL,
    supportChannelId:LIVE_CHANNEL, ticketToolApplicationId:TICKET_TOOL, now, rest,
    readRanking:(guildId, userId) => { rankingCalls.push({ guildId, userId }); return { rows:[], you:null, total:0 }; },
    onError:() => {}, ...options });
  const server = createServer((request, response) => bot.handle(request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  async function send(extra = {}) {
    const value = { id:String(sequence++), application_id:CLIENT, type:2, guild_id:GUILD, channel_id:TEST_CHANNEL,
      member:{ permissions:'8', user:{ id:USER, username:'Admin' } }, data:{ name:'participate' }, ...extra };
    const body = JSON.stringify(value), timestamp = String(now() / 1000);
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method:'POST', headers:{
      'Content-Type':'application/json', 'X-Signature-Timestamp':timestamp,
      'X-Signature-Ed25519':sign(null, Buffer.from(timestamp + body), keys.privateKey).toString('hex'),
    }, body });
    return { status:response.status, body:await response.json() };
  }
  return { db, bot, calls, rankingCalls, send, async close() {
    await bot.whenIdle(); await new Promise(resolve => server.close(resolve)); db.close();
  } };
}

test('environment passes the optional test channel; malformed nonempty IDs disable the endpoint', async () => {
  assert.equal(botOptionsFromEnv({ DISCORD_TEST_CHANNEL_ID:TEST_CHANNEL }).testChannelId, TEST_CHANNEL);
  assert.equal(botOptionsFromEnv({}).testChannelId, '');
  for (const testChannelId of ['invalid', ' ', '123', `${TEST_CHANNEL}/messages`, null]) {
    const f = await fixture({ testChannelId });
    try {
      assert.equal(f.bot.configured, false);
      assert.equal((await f.send({ type:1 })).status, 503);
      assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
  }
});

test('signed PING works in test mode without channel or member information', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.send({ type:1, channel_id:undefined, member:undefined }), { status:200, body:{ type:1 } });
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_interaction_cache').get().count, 0);
  } finally { await f.close(); }
});

test('test mode rejects every command and button outside its channel or without Administrator before side effects', async () => {
  const f = await fixture();
  try {
    const actions = ['play', 'participate', 'trail-ranking', 'trail-profile', 'support', 'bot-setup'];
    for (const data of [...actions.map(name => ({ name })), { custom_id:'trail:play' }, { custom_id:'trail:join' }, { custom_id:'trail:ranking' }, { custom_id:'trail:support' }]) {
      for (const extra of [
        { channel_id:LIVE_CHANNEL }, { channel_id:undefined },
        ...['0', '32', '-8', 'invalid', undefined].map(permissions => ({ member:{ permissions, user:{ id:USER } } })),
      ]) {
        const result = await f.send({ data, type:data.custom_id ? 3 : 2, ...extra });
        assert.equal(result.status, 200);
        assert.equal(result.body.data.flags, 64);
        assert.match(result.body.data.content, /Admin test mode.*administrators.*test channel/);
      }
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_interaction_cache').get().count, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 0);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.rankingCalls, []);
  } finally { await f.close(); }
});

test('test administrators can participate and rank, but cached replies cannot bypass the test lock', async () => {
  const f = await fixture();
  try {
    const id = '999999999999999999';
    assert.match((await f.send({ id })).body.data.content, /registered/);
    assert.match((await f.send({ data:{ name:'trail-ranking' } })).body.data.embeds[0].description, /No verified results/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 1);
    assert.equal(f.rankingCalls.length, 1);
    assert.match((await f.send({ id, channel_id:LIVE_CHANNEL })).body.data.content, /Admin test mode/);
    assert.match((await f.send({ id, member:{ permissions:'32', user:{ id:USER } } })).body.data.content, /Admin test mode/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_interaction_cache').get().count, 2);
  } finally { await f.close(); }
});

test('Activity entry points launch only after the test channel, administrator and server checks', async () => {
  const f = await fixture();
  try {
    const data = { name:'Launch', type:4 };
    for (const extra of [
      { channel_id:LIVE_CHANNEL },
      { member:{ permissions:'32', user:{ id:USER } } },
      { guild_id:'999999999999999999' },
    ]) {
      const result = await f.send({ data, ...extra });
      assert.equal(result.body.type, 4);
      assert.equal(result.body.data.flags, 64);
      assert.match(result.body.data.content, /Admin test mode|configured server/);
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_interaction_cache').get().count, 0);
    assert.deepEqual(await f.send({ data:{ name:'A renamed activity', type:4 } }), { status:200, body:{ type:12 } });
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 1);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('all panel operations and support links stay in the test channel despite a live support setting and extra options', async () => {
  const f = await fixture();
  try {
    const reply = await f.send({ data:{ name:'support' } });
    assert.match(reply.body.data.content, new RegExp(`<#${TEST_CHANNEL}>`));
    assert.doesNotMatch(reply.body.data.content, new RegExp(LIVE_CHANNEL));
    for (const name of ['game-panel', 'support-card', 'support-update', 'support-hide', 'support-restore']) {
      const result = await f.send({ token:'test-response-token', data:{ name:'bot-setup', options:[{ type:1, name, options:[
        { name:'text', value:'Private test support card' }, { name:'message', value:name.startsWith('support-h') || name === 'support-restore' ? TICKET : CARD },
        { name:'channel', value:LIVE_CHANNEL },
      ] }] } });
      assert.deepEqual(result.body, { type:5, data:{ flags:64 } });
      await f.bot.whenIdle();
    }
    const channelCalls = f.calls.filter(({ path }) => path.startsWith('/channels/'));
    assert.ok(channelCalls.some(({ method }) => method === 'POST'));
    assert.ok(channelCalls.some(({ method }) => method === 'PATCH'));
    for (const { path } of channelCalls) assert.ok(path.startsWith(`/channels/${TEST_CHANNEL}`), path);
    for (const { path } of f.calls) assert.equal(path.includes(LIVE_CHANNEL), false, path);
  } finally { await f.close(); }
});
