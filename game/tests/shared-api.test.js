import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameApi } from '../server/api.js';
import { openDatabase } from '../server/database.js';
import { replayRun } from '../server/replay.js';
import { createLevelDirector } from '../src/level-director.js';
import { recordedVictory } from './fixtures/ranked-run.js';
import { createSqliteGameStore } from '../server/game-store.js';
import { withSeededProfiles } from './fixtures/seeded-store.js';

const USERS = { alice:'123456789012345678', bob:'223456789012345678' };
async function fixture(options = {}) {
  let time = 1000000;
  const gameStore = withSeededProfiles(createSqliteGameStore(options.databasePath ?? ':memory:',
    {eventId:options.eventId ?? 'tag',now:()=>time}), 'shared-api-fixed');
  const api = createGameApi({ clientId:'1556624227212460092', now:() => time, authenticate:async ({ code, guildId }) => {
    if (!USERS[code] || guildId === '999999999999999999') throw new Error('Not a member');
    return { profile:{ id:USERS[code], name:code === 'alice' ? 'Alice' : '<Bob>', avatar:'https://cdn.discordapp.com/embed/avatars/0.png' }, accessToken:'fake-discord-token', expiresIn:3600 };
  }, ...options, gameStore });
  const server = createServer((req, res) => api.handle(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { token, method = 'GET', body, origin } = {}) {
    const response = await fetch(`${base}/api${path}`, { method, headers:{ ...(token ? { Authorization:`Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type':'application/json' } : {}), ...(origin ? { Origin:origin } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) });
    return { status:response.status, body:await response.json() };
  }
  async function login(code, guildId = '333333333333333333') { return (await request('/discord/session', { method:'POST', body:{ code, guildId } })).body; }
  return { request, login, tick(seconds) { time += seconds * 1000; }, async close() { await new Promise(resolve => server.close(resolve)); api.close(); } };
}

test('two authenticated players share a durable board, with one verified best result each', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'forest-trail-api-'));
  const path = join(directory, 'rankings.sqlite');
  let f = await fixture({ databasePath:path });
  try {
    const alice = await f.login('alice'), bob = await f.login('bob');
    assert.equal(alice.profile.name, 'Alice'); assert.equal(bob.profile.name, '<Bob>');
    for (const session of [alice, bob]) {
      const plan = (await f.request('/runs', { token:session.token, method:'POST', body:{} })).body;
      assert.equal(plan.config.rulesVersion, 12);
      assert.equal(plan.config.mode, 'storm');
      assert.equal(plan.config.timeLimit, 70);
      assert.deepEqual(plan.config.mechanics, { orderedCoins:true, pulseTraps:true, alarm:true, armor:true, exitWindow:true,
        lava:true, crumble:true, lasers:true, hunter:true, dash:true });
      const recording = recordedVictory(plan.config); f.tick(recording.seconds + 1);
      const submitted = { ticket:plan.ticket, trace:recording.trace, score:9999999, level:999, userId:'imposter' };
      const result = await f.request('/runs/finish', { token:session.token, method:'POST', body:submitted });
      assert.equal(result.status, 200); assert.equal(result.body.status, 'won'); assert.equal(result.body.level, 1);
      assert.ok(result.body.score > 0 && result.body.score < submitted.score);
      assert.equal(result.body.score, replayRun(plan.config, recording.trace).score);
      assert.deepEqual((await f.request('/runs/finish', { token:session.token, method:'POST', body:submitted })).body, result.body);
      const next = (await f.request('/runs', { token:session.token, method:'POST', body:{} })).body;
      assert.equal(next.config.level, 2);
      assert.equal(next.config.layoutId, 'rustworks');
      assert.equal(next.config.rulesVersion, 12);
      assert.equal(next.config.mode, 'storm');
      assert.equal(next.config.timeLimit, 65);
      assert.deepEqual(next.config.enemies, ['wisp','scout','sentinel','scout']);
      assert.notEqual(next.config.layoutId, plan.config.layoutId);
    }
    const board = (await f.request('/leaderboard', { token:alice.token })).body;
    assert.equal(board.total, 2); assert.equal(board.rows.length, 2); assert.equal(board.you.userId, USERS.alice);
    assert.deepEqual(new Set(board.rows.map(row => row.name)), new Set(['Alice','<Bob>']));
    await f.close(); f = await fixture({ databasePath:path });
    const reopened = await f.login('alice');
    assert.equal((await f.request('/leaderboard', { token:reopened.token })).body.total, 2);
    assert.equal((await f.request('/runs', { token:reopened.token, method:'POST', body:{} })).body.config.level, 2);
  } finally { await f.close(); rmSync(directory, { recursive:true, force:true }); }
});

test('verified scores remain attached to Discord ID after a server restart and nickname change', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'forest-trail-rename-'));
  const databasePath = join(directory, 'scores.sqlite');
  let name = 'Original nickname';
  const authenticate = async () => ({ accessToken:'fixture-token', expiresIn:3600,
    profile:{ id:USERS.alice, name, avatar:'https://cdn.discordapp.com/embed/avatars/0.png' } });
  let f = await fixture({ databasePath, authenticate });
  try {
    const session = await f.login('alice');
    const plan = (await f.request('/runs', { token:session.token, method:'POST', body:{} })).body;
    const recording = recordedVictory(plan.config); f.tick(recording.seconds + 1);
    const result = await f.request('/runs/finish', { token:session.token, method:'POST', body:{ ticket:plan.ticket, trace:recording.trace } });
    assert.equal(result.body.status, 'won');
    const score = result.body.score;
    await f.close(); name = 'Renamed player';
    f = await fixture({ databasePath, authenticate });
    const reconnected = await f.login('alice');
    const board = (await f.request('/leaderboard', { token:reconnected.token })).body;
    assert.equal(board.total, 1);
    assert.equal(board.you.userId, USERS.alice);
    assert.equal(board.you.name, name);
    assert.equal(board.you.score, score);
  } finally { await f.close(); rmSync(directory, { recursive:true, force:true }); }
});

test('an outstanding ticket with implicit legacy rules survives deployment and advances to hard rules after finishing', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'forest-trail-legacy-api-'));
  const path = join(directory, 'rankings.sqlite'), board = 'guild:333333333333333333:event:tag';
  const saved = { version:1, seed:'legacy-issued-api', level:2, skill:1, streak:1, attempt:0, recentMaps:['crossing'],
    active:{ level:2, tier:1, layoutId:'rustworks', attempt:0, status:'ready' } };
  const legacy = createLevelDirector({ storage:{ getItem:() => JSON.stringify(saved), setItem() { throw new Error('Legacy reads must not persist'); } } }).current();
  delete legacy.rulesVersion; // The already issued pre-deployment ticket did not contain this field.
  const db = openDatabase(path);
  try {
    db.prepare('INSERT INTO profiles(board,user_id,name,avatar,progress) VALUES(?,?,?,?,?)')
      .run(board, USERS.alice, 'Alice', '', JSON.stringify(saved));
    db.prepare('INSERT INTO attempts(id,board,user_id,config,started_at) VALUES(?,?,?,?,?)')
      .run('legacy-ready-ticket', board, USERS.alice, JSON.stringify(legacy), 990000);
  } finally { db.close(); }
  const f = await fixture({ databasePath:path });
  try {
    const alice = await f.login('alice');
    const resumed = await f.request('/runs', { token:alice.token, method:'POST', body:{} });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.ticket, 'legacy-ready-ticket');
    assert.deepEqual(resumed.body.config, legacy, 'return the original stored ticket without upgrading its rules');
    assert.equal(resumed.body.config.timeLimit, 180);
    const recording = recordedVictory(resumed.body.config); f.tick(recording.seconds + 1);
    const result = await f.request('/runs/finish', { token:alice.token, method:'POST', body:{ ticket:resumed.body.ticket, trace:recording.trace } });
    assert.equal(result.status, 200); assert.equal(result.body.status, 'won'); assert.equal(result.body.level, 2);
    assert.equal(result.body.score, replayRun(legacy, recording.trace).score);
    const next = await f.request('/runs', { token:alice.token, method:'POST', body:{} });
    assert.equal(next.status, 200); assert.notEqual(next.body.ticket, resumed.body.ticket);
    assert.equal(next.body.config.level, 3); assert.equal(next.body.config.rulesVersion, 12);
    assert.equal(next.body.config.timeLimit, 60); assert.equal(next.body.config.maxHits, 3);
    assert.equal(next.body.config.mechanics.orderedCoins, true);
    assert.equal((await f.request('/leaderboard', { token:alice.token })).body.you.level, 2);
  } finally { await f.close(); rmSync(directory, { recursive:true, force:true }); }
});

for (const rulesVersion of [2,3,4,5,6,7,8,9,10,11]) test(`an outstanding version-${rulesVersion} ticket keeps its rules and finishes before version-twelve progression`, async () => {
  const directory = mkdtempSync(join(tmpdir(), `forest-trail-v${rulesVersion}-api-`));
  const path = join(directory, 'rankings.sqlite'), board = 'guild:333333333333333333:event:tag';
  const saved = { version:1, seed:`v${rulesVersion}-issued-api`, level:1, skill:0, streak:0, attempt:0, recentMaps:[],
    active:{ level:1, tier:0, layoutId:'crossing', attempt:0, status:'ready', rulesVersion } };
  const previous = createLevelDirector({ storage:{ getItem:() => JSON.stringify(saved), setItem() { throw new Error('Pending reads must not persist'); } } }).current();
  const db = openDatabase(path);
  try {
    db.prepare('INSERT INTO profiles(board,user_id,name,avatar,progress) VALUES(?,?,?,?,?)')
      .run(board, USERS.alice, 'Alice', '', JSON.stringify(saved));
    db.prepare('INSERT INTO attempts(id,board,user_id,config,started_at) VALUES(?,?,?,?,?)')
      .run(`v${rulesVersion}-ready-ticket`, board, USERS.alice, JSON.stringify(previous), 990000);
  } finally { db.close(); }
  const f = await fixture({ databasePath:path });
  try {
    const alice = await f.login('alice');
    const resumed = await f.request('/runs', { token:alice.token, method:'POST', body:{} });
    assert.equal(resumed.body.ticket, `v${rulesVersion}-ready-ticket`);
    assert.deepEqual(resumed.body.config, previous);
    assert.equal(resumed.body.config.rulesVersion, rulesVersion);
    assert.deepEqual(resumed.body.config.mechanics, { orderedCoins:true, pulseTraps:true, alarm:true, armor:true, exitWindow:true,
      ...(rulesVersion >= 3 ? { lava:true, crumble:true, lasers:true, hunter:true, dash:true } : {}) });
    const recording = recordedVictory(resumed.body.config); f.tick(recording.seconds + 1);
    const result = await f.request('/runs/finish', { token:alice.token, method:'POST', body:{ ticket:resumed.body.ticket, trace:recording.trace } });
    assert.equal(result.status, 200); assert.equal(result.body.status, 'won');
    assert.equal(result.body.score, replayRun(previous, recording.trace).score);
    const next = await f.request('/runs', { token:alice.token, method:'POST', body:{} });
    assert.equal(next.body.config.level, 2); assert.equal(next.body.config.rulesVersion, 12);
    assert.equal(next.body.config.mechanics.lava, true); assert.equal(next.body.config.mechanics.dash, true);
  } finally { await f.close(); rmSync(directory, { recursive:true, force:true }); }
});

test('authentication, guild boundaries, restart tickets, expiry and origin checks are enforced', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/leaderboard')).status, 401);
    assert.equal((await f.request('/discord/session', { method:'POST', body:{ code:'alice', guildId:'999999999999999999' } })).status, 401);
    assert.equal((await f.request('/discord/session', { method:'POST', body:{ code:'alice', guildId:{} } })).status, 400);
    const alice = await f.login('alice'), bob = await f.login('bob'), otherGuild = await f.login('alice', '444444444444444444');
    const plan = (await f.request('/runs', { token:alice.token, method:'POST', body:{} })).body;
    assert.equal((await f.request('/runs/finish', { token:bob.token, method:'POST', body:{ ticket:plan.ticket, trace:[] } })).status, 404);
    assert.equal((await f.request('/runs/finish', { token:otherGuild.token, method:'POST', body:{ ticket:plan.ticket, trace:[] } })).status, 404);
    assert.equal((await f.request('/leaderboard', { token:alice.token, origin:'https://unrelated.example' })).status, 403);
    const restarted = (await f.request('/runs', { token:alice.token, method:'POST', body:{ restart:true } })).body;
    assert.equal(restarted.config.level, 1); assert.notEqual(restarted.ticket, plan.ticket);
    assert.equal((await f.request('/runs/finish', { token:alice.token, method:'POST', body:{ ticket:plan.ticket, trace:[] } })).status, 409);
    const recording = recordedVictory(restarted.config);
    const tooFast = await f.request('/runs/finish', { token:alice.token, method:'POST', body:{ ticket:restarted.ticket, trace:recording.trace } });
    assert.equal(tooFast.status, 422);
    assert.match(tooFast.body.error, /faster than its verified duration/);
    assert.equal((await f.request('/leaderboard', { token:alice.token })).body.total, 0);
    assert.equal((await f.request('/leaderboard', { token:otherGuild.token })).body.total, 0);
    f.tick(3601); assert.equal((await f.request('/leaderboard', { token:alice.token })).status, 401);
  } finally { await f.close(); }
});

test('an unconfigured backend exposes no credentials and leaves profile connection disabled', async () => {
  const f = await fixture({ authenticate:undefined, clientSecret:'' });
  try {
    const config = await f.request('/config');
    assert.equal(config.body.configured, false);
    assert.equal('clientSecret' in config.body, false);
    assert.equal((await f.request('/discord/session', { method:'POST', body:{ code:'anything' } })).status, 503);
  } finally { await f.close(); }
});

test('the bot can only read a server board with its separate service key', async () => {
  const key = 'test-service-key-for-ranking-read-only-1234567890';
  const f = await fixture({ botApiKey:key });
  try {
    assert.equal((await f.request(`/bot/leaderboard?guildId=333333333333333333&userId=${USERS.alice}`, { token:'wrong' })).status, 401);
    const board = await f.request(`/bot/leaderboard?guildId=333333333333333333&userId=${USERS.alice}`, { token:key });
    assert.equal(board.status, 200); assert.equal(board.body.total, 0);
    assert.equal((await f.request('/bot/leaderboard?guildId=bad', { token:key })).status, 400);
    assert.equal((await f.request('/runs', { token:key, method:'POST', body:{} })).status, 401);
  } finally { await f.close(); }
});
