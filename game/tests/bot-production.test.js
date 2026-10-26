import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createProductionServer } from '../server/main.js';
import { recordedVictory } from './fixtures/ranked-run.js';

test('production bot reads actual verified game results from the shared campaign database', async () => {
  const clientId = '1556624227212460092', guildId = '333333333333333333', userId = '123456789012345678';
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const key = publicKey.export({ format:'der', type:'spki' }).subarray(-32).toString('hex');
  let time = 1792630000000, sequence = 100000000000000000n;
  const server = createProductionServer({ clientId, now:() => time, bot:{ publicKey:key, guildId },
    authenticate:async () => ({ profile:{ id:userId, name:'Player', avatar:'' }, accessToken:'test-oauth', expiresIn:3600 }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function command(name, extra = {}) {
    const body = JSON.stringify({ id:String(sequence++), application_id:clientId, type:2, guild_id:guildId,
      member:{ user:{ id:userId, username:'Player' } }, data:{ name }, ...extra });
    const timestamp = String(Math.floor(time / 1000));
    const response = await fetch(`${base}/api/discord/interactions`, { method:'POST', headers:{
      'Content-Type':'application/json', 'X-Signature-Timestamp':timestamp,
      'X-Signature-Ed25519':sign(null, Buffer.from(timestamp + body), privateKey).toString('hex'),
    }, body });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function api(path, body, token) {
    const response = await fetch(`${base}/api${path}`, { method:'POST', headers:{ 'Content-Type':'application/json',
      ...(token ? { Authorization:`Bearer ${token}` } : {}) }, body:JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  }
  try {
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status:'ok', botConfigured:true });
    assert.match((await command('participate')).data.content, /registered/);
    assert.match((await command('trail-ranking')).data.embeds[0].description, /No verified results/);
    const session = await api('/discord/session', { code:'test', guildId });
    const run = await api('/runs', {}, session.token);
    const victory = recordedVictory(run.config);
    time += (victory.seconds + 1) * 1000;
    const result = await api('/runs/finish', { ticket:run.ticket, trace:victory.trace }, session.token);
    assert.equal(result.status, 'won');
    const ranking = await command('trail-ranking');
    assert.match(ranking.data.embeds[0].description, new RegExp(`level 1 · ${result.score} pts`));
    assert.match(ranking.data.embeds[0].description, /Your verified result: \*\*#1/);
    assert.match((await command('trail-profile')).data.embeds[0].description, /joined this campaign/);
    assert.match((await command('trail-ranking', { guild_id:'444444444444444444' })).data.content, /configured server/);
    assert.equal((await fetch(`${base}/server/bot/interactions.js`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
