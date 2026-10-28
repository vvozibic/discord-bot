import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordService } from '../src/discord-service.js';
import { normalizeRewards } from '../src/rewards.js';

const reply = (body, status = 200) => ({ ok:status < 400, status, json:async () => body });
const flush = () => new Promise(resolve => setImmediate(resolve));
const empty = () => normalizeRewards(null);
const unlocked = () => normalizeRewards({ unlocked:['clean-run'] });
const styled = () => normalizeRewards({ unlocked:['clean-run'], equipped:{ palette:'moonlight',trail:'none',badge:'none' } });
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
async function connectedService(handle) {
  let user = 'player-a';
  const service = createDiscordService({ fetchImpl:async (path, options) => {
    if (path === '/api/config') return reply({ configured:true });
    if (path === '/api/discord/session') return reply(options.method === 'DELETE' ? { disconnected:true }
      : { token:`token-${user}`, accessToken:'oauth', profile:{ id:user,name:user }, rewards:empty() });
    return handle(path, options);
  } });
  await service.initialize();
  service.setSdk({ commands:{ authorize:async () => ({ code:'code' }), authenticate:async () => ({ user:{ id:user } }) } }, 'app');
  await service.connect();
  return { service, async switchPlayer() { await service.disconnect(); user = 'player-b'; await service.connect(); } };
}

test('a delayed collection load finishes before a queued verified unlock and cannot roll it back', async () => {
  const loading = deferred(), calls = [];
  const { service } = await connectedService(async (path, options) => {
    calls.push(`${options.method} ${path}`);
    if (path === '/api/rewards') return loading.promise;
    return reply({ status:'won', rewards:unlocked(), newAchievements:['clean-run'] });
  });
  const load = service.loadRewards();
  await flush();
  const finish = service.finishRun('ticket-a', []);
  await flush();
  assert.deepEqual(calls, ['GET /api/rewards']);
  loading.resolve(reply(empty()));
  await load; await finish;
  assert.deepEqual(calls, ['GET /api/rewards','POST /api/runs/finish']);
  assert.deepEqual(service.rewards, unlocked());
});

test('a load and style save queued behind verification see its new unlock in order', async () => {
  const verifying = deferred(), calls = [];
  let serverRewards = empty();
  const { service } = await connectedService(async (path, options) => {
    calls.push(`${options.method} ${path}`);
    assert.equal(options.headers.Authorization, 'Bearer token-player-a');
    if (path === '/api/runs/finish') {
      await verifying.promise; serverRewards = unlocked();
      return reply({ status:'won', rewards:serverRewards, newAchievements:['clean-run'] });
    }
    if (options.method === 'PUT') {
      assert.deepEqual(serverRewards.unlocked, ['clean-run']);
      assert.deepEqual(JSON.parse(options.body).equipped, styled().equipped);
      serverRewards = styled();
    }
    return reply(serverRewards);
  });
  const finish = service.finishRun('ticket-a', []);
  const load = service.loadRewards();
  const save = service.equipRewards(styled().equipped);
  await flush();
  assert.deepEqual(calls, ['POST /api/runs/finish']);
  verifying.resolve();
  await finish;
  assert.deepEqual(await load, unlocked());
  assert.deepEqual(await save, styled());
  assert.deepEqual(calls, ['POST /api/runs/finish','GET /api/rewards','PUT /api/rewards']);
  assert.deepEqual(service.rewards, styled());
});

test('a failed rewards request does not block the next queued request', async () => {
  const loading = deferred(), calls = [];
  const { service } = await connectedService(async (path, options) => {
    calls.push(options.method);
    return options.method === 'GET' ? loading.promise : reply(styled());
  });
  const failed = assert.rejects(service.loadRewards(), /Temporary failure/);
  const save = service.equipRewards(styled().equipped);
  await flush();
  assert.deepEqual(calls, ['GET']);
  loading.resolve(reply({ error:'Temporary failure' }, 503));
  await failed;
  assert.deepEqual(await save, styled());
  assert.deepEqual(calls, ['GET','PUT']);
});

test('a new login bypasses an old queue and rejects stale in-flight and queued operations', async () => {
  const oldLoad = deferred(), calls = [];
  const { service, switchPlayer } = await connectedService(async (path, options) => {
    calls.push({ path,method:options.method,token:options.headers.Authorization });
    return options.headers.Authorization === 'Bearer token-player-a' ? oldLoad.promise : reply(unlocked());
  });
  const staleLoad = assert.rejects(service.loadRewards(), /profile changed/);
  await flush();
  const staleFinish = assert.rejects(service.finishRun('old-ticket', []), /profile changed/);
  const staleSave = assert.rejects(service.equipRewards(styled().equipped), /profile changed/);
  await switchPlayer();
  assert.deepEqual(await service.loadRewards(), unlocked(), 'new account must not wait for the old response');
  assert.equal(service.profile.id, 'player-b');
  oldLoad.resolve(reply(styled()));
  await Promise.all([staleLoad,staleFinish,staleSave]);
  assert.deepEqual(service.rewards, unlocked(), 'old response cannot equip a reward on the new profile');
  assert.deepEqual(calls, [
    { path:'/api/rewards',method:'GET',token:'Bearer token-player-a' },
    { path:'/api/rewards',method:'GET',token:'Bearer token-player-b' },
  ], 'old queued writes must never reach either account');
});
