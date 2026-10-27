import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { openPostgresGameStore } from '../server/postgres-store.js';
import { createGameApi } from '../server/api.js';
import { recordedVictory } from './fixtures/ranked-run.js';
import { withSeededProfiles } from './fixtures/seeded-store.js';

const databaseUrl = process.env.GAME_TEST_DATABASE_URL;
const USERS = { alice:'123456789012345678', bob:'223456789012345678' };
const GUILD = '333333333333333333';

async function fixture(eventId, clock, names = { alice:'Alice', bob:'Bob' }) {
  const gameStore = withSeededProfiles(await openPostgresGameStore(databaseUrl), 'postgres-api-fixed');
  const api = createGameApi({ gameStore, eventId, clientId:'1466831420575186985', now:() => clock.time,
    authenticate:async ({ code, guildId }) => {
      if (!USERS[code] || guildId !== GUILD) throw new Error('Not a member');
      return { profile:{ id:USERS[code], name:names[code], avatar:'' }, accessToken:'test-only-access-token', expiresIn:3600 };
    } });
  const server = createServer((req, res) => api.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
    const response = await fetch(base + path, { method, headers:{ ...(token ? {Authorization:`Bearer ${token}`} : {}),
      ...(body ? {'Content-Type':'application/json'} : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) });
    return { status:response.status, body:await response.json() };
  }
  return { request, async login(code) { return (await request('/discord/session', {body:{code,guildId:GUILD}})).body; },
    async close() { await new Promise(resolve => server.close(resolve)); await api.close(); } };
}

async function clearBoard(pool, board) {
  for (const table of ['forest_scores', 'forest_attempts', 'forest_profiles'])
    await pool.query(`DELETE FROM ${table} WHERE board=$1`, [board]);
}

test('PostgreSQL retains verified results and nicknames without modifying existing bot tables', { skip:!databaseUrl, timeout:30000 }, async t => {
  const pool = new Pool({connectionString:databaseUrl});
  t.after(() => pool.end());
  const eventId = `postgres-test-${randomUUID()}`, board = `guild:${GUILD}:event:${eventId}`;
  const sentinel = `fixture-${randomUUID()}`, clock = { time:1000000 }, names = {alice:'Alice',bob:'Bob'};
  await pool.query('CREATE TABLE IF NOT EXISTS x_accounts(discord_id TEXT PRIMARY KEY,x_username TEXT)');
  await pool.query('INSERT INTO x_accounts(discord_id,x_username) VALUES($1,$2)', [sentinel,'retain-this-bot-record']);
  const before = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='x_accounts' ORDER BY ordinal_position")).rows;
  let f;
  t.after(async () => { if (f) await f.close(); });
  try {
    f = await fixture(eventId, clock, names);
    const alice = await f.login('alice');
    const plan = (await f.request('/runs', { token:alice.token, body:{} })).body;
    const recording = recordedVictory(plan.config);
    clock.time += (recording.seconds + 1) * 1000;
    const result = await f.request('/runs/finish', { token:alice.token, body:{ticket:plan.ticket,trace:recording.trace,score:99999999} });
    assert.equal(result.status, 200); assert.equal(result.body.status, 'won');
    assert.ok(result.body.score > 0 && result.body.score < 99999999);
    await f.close(); names.alice = 'Renamed Alice'; f = await fixture(eventId, clock, names);
    const renamed = await f.login('alice');
    const ranking = (await f.request('/leaderboard', {token:renamed.token})).body;
    assert.equal(ranking.total, 1); assert.equal(ranking.you.userId, USERS.alice);
    assert.equal(ranking.you.name, 'Renamed Alice'); assert.equal(ranking.you.rank, 1);
    assert.equal(ranking.you.score, result.body.score);
    assert.equal((await f.request('/runs', {token:renamed.token,body:{}})).body.config.level, 2);
    assert.equal((await pool.query('SELECT x_username FROM x_accounts WHERE discord_id=$1',[sentinel])).rows[0].x_username, 'retain-this-bot-record');
    const after = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='x_accounts' ORDER BY ordinal_position")).rows;
    assert.deepEqual(after, before);
  } finally { if (f) await f.close(); await clearBoard(pool,board); await pool.query('DELETE FROM x_accounts WHERE discord_id=$1',[sentinel]); }
});

test('concurrent PostgreSQL instances resume one ticket and record a duplicate finish exactly once', { skip:!databaseUrl, timeout:30000 }, async t => {
  const eventId = `postgres-race-${randomUUID()}`, board = `guild:${GUILD}:event:${eventId}`, clock = {time:1000000};
  const pool = new Pool({connectionString:databaseUrl});
  t.after(() => pool.end());
  const first = await fixture(eventId,clock);
  t.after(() => first.close());
  const second = await fixture(eventId,clock);
  t.after(() => second.close());
  try {
    const [a,b] = await Promise.all([first.login('alice'),second.login('alice')]);
    const plans = await Promise.all([first.request('/runs',{token:a.token,body:{}}),second.request('/runs',{token:b.token,body:{}})]);
    assert.equal(plans[0].status,200); assert.equal(plans[1].status,200);
    assert.equal(plans[0].body.ticket,plans[1].body.ticket);
    const plan=plans[0].body, recording=recordedVictory(plan.config);
    clock.time += (recording.seconds+1)*1000;
    const results = await Promise.all([
      first.request('/runs/finish',{token:a.token,body:{ticket:plan.ticket,trace:recording.trace}}),
      second.request('/runs/finish',{token:b.token,body:{ticket:plan.ticket,trace:recording.trace}}),
    ]);
    assert.equal(results[0].status,200); assert.equal(results[1].status,200);
    assert.deepEqual(results[0].body,results[1].body);
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM forest_scores WHERE board=$1',[board])).rows[0].count),1);
  } finally { await Promise.all([first.close(),second.close()]); await clearBoard(pool,board); }
});

test('PostgreSQL rejects foreign tickets and rolls back invalid replays without changing progress', { skip:!databaseUrl, timeout:30000 }, async t => {
  const eventId=`postgres-access-${randomUUID()}`,board=`guild:${GUILD}:event:${eventId}`,clock={time:1000000};
  const f=await fixture(eventId,clock),pool=new Pool({connectionString:databaseUrl});
  t.after(() => f.close());
  t.after(() => pool.end());
  try {
    const alice=await f.login('alice'),bob=await f.login('bob');
    const plan=(await f.request('/runs',{token:alice.token,body:{}})).body;
    assert.equal((await f.request('/runs/finish',{token:bob.token,body:{ticket:plan.ticket,trace:[]}})).status,404);
    const saved=(await pool.query('SELECT progress FROM forest_profiles WHERE board=$1 AND user_id=$2',[board,USERS.alice])).rows[0].progress;
    assert.equal((await f.request('/runs/finish',{token:alice.token,body:{ticket:plan.ticket,trace:'invalid'}})).status,422);
    assert.equal((await pool.query('SELECT progress FROM forest_profiles WHERE board=$1 AND user_id=$2',[board,USERS.alice])).rows[0].progress,saved);
    assert.equal((await pool.query('SELECT status FROM forest_attempts WHERE id=$1',[plan.ticket])).rows[0].status,'ready');
    const restarted=await f.request('/runs',{token:alice.token,body:{restart:true}});
    assert.notEqual(restarted.body.ticket,plan.ticket);
    assert.equal((await f.request('/runs/finish',{token:alice.token,body:{ticket:plan.ticket,trace:[]}})).status,409);
    clock.time+=3601000;
    const refreshed=await f.login('alice');
    assert.equal((await f.request('/runs/finish',{token:refreshed.token,body:{ticket:restarted.body.ticket,trace:[]}})).status,409);
  } finally {await f.close();await clearBoard(pool,board);}
});
