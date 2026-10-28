import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordAuth } from '../server/discord-auth.js';
import { createDiscordService, discordAvatarUrl } from '../src/discord-service.js';

const CLIENT = '1556624227212460092', USER = '123456789012345678', GUILD = '333333333333333333';
function reply(body, status = 200) { return { ok:status < 400, status, json:async () => body }; }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('Discord OAuth verifies the app and server membership and derives the server profile', async () => {
  const calls = [];
  const authenticate = createDiscordAuth({ clientId:CLIENT, clientSecret:'server-only-secret', fetchImpl:async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth2/token')) return reply({ access_token:'secret-access-token', expires_in:7200 });
    if (url.endsWith('/oauth2/@me')) return reply({ application:{ id:CLIENT }, scopes:['identify','guilds.members.read'] });
    if (url.endsWith('/users/@me')) return reply({ id:USER, username:'alice', global_name:'Alice', avatar:null });
    if (url.endsWith('/member')) return reply({ user:{ id:USER }, nick:'Guild Alice', avatar:'a_0123456789abcdef0123456789abcdef' });
    throw new Error('Unexpected request');
  } });
  const result = await authenticate({ code:'valid-code', guildId:GUILD });
  assert.equal(result.profile.name, 'Guild Alice');
  assert.equal(result.profile.id, USER);
  assert.equal(result.profile.avatar, `https://cdn.discordapp.com/guilds/${GUILD}/users/${USER}/avatars/a_0123456789abcdef0123456789abcdef.png?size=64`);
  assert.equal(result.expiresIn, 3600);
  assert.equal(calls[0].options.body.get('client_secret'), 'server-only-secret');
  assert.equal(calls[0].options.body.get('grant_type'), 'authorization_code');
  assert.ok(calls.every(call => !call.url.includes('secret-access-token')));
});

test('OAuth rejects a token for another app, absent scopes, and unverifiable membership', async () => {
  for (const scenario of ['wrong-app','missing-scope','not-member']) {
    const authenticate = createDiscordAuth({ clientId:CLIENT, clientSecret:'private', fetchImpl:async url => {
      if (url.endsWith('/oauth2/token')) return reply({ access_token:'token', expires_in:1000 });
      if (url.endsWith('/oauth2/@me')) return reply({ application:{ id:scenario === 'wrong-app' ? 'wrong' : CLIENT }, scopes:scenario === 'missing-scope' ? ['identify'] : ['identify','guilds.members.read'] });
      if (url.endsWith('/users/@me')) return reply({ id:USER, username:'Alice' });
      return reply({}, 403);
    } });
    await assert.rejects(authenticate({ code:'valid', guildId:GUILD }));
  }
});

test('the production beta checks the exact guild before OAuth and role IDs from verified membership', async () => {
  const role = '1564276225520963726';
  let roles = [], requests = 0;
  const authenticate = createDiscordAuth({ clientId:CLIENT, clientSecret:'fixture-secret',
    allowedGuildId:GUILD, allowedRoleIds:[role], fetchImpl:async url => {
      requests += 1;
      if (url.endsWith('/oauth2/token')) return reply({ access_token:'fixture-access-token', expires_in:1000 });
      if (url.endsWith('/oauth2/@me')) return reply({ application:{ id:CLIENT }, scopes:['identify','guilds.members.read'] });
      if (url.endsWith('/users/@me')) return reply({ id:USER, username:'Alice' });
      return reply({ user:{ id:USER }, nick:'Beta Alice', roles });
    } });
  for (const guildId of [null, '999999999999999999']) {
    await assert.rejects(authenticate({ code:'valid-code', guildId }), /Mindo AI/);
    assert.equal(requests, 0);
  }
  for (roles of [[], ['1564276225520963727'], ['beta-tester']])
    await assert.rejects(authenticate({ code:'valid-code', guildId:GUILD }), /beta-tester/);
  roles = [role];
  assert.equal((await authenticate({ code:'valid-code', guildId:GUILD })).profile.name, 'Beta Alice');
});

test('the game connects via the SDK and keeps its own session token in memory only', async () => {
  const requests = [], commands = [];
  const service = createDiscordService({ fetchImpl:async (url, options) => {
    requests.push({ url, options });
    if (url === '/api/config') return reply({ configured:true, clientId:CLIENT, eventName:'TAG' });
    if (url === '/api/discord/session' && options.method === 'POST') return reply({ token:'application-token', accessToken:'discord-token', profile:{ id:USER, name:'Alice', avatar:'' }, boardName:'Server · TAG' });
    if (url === '/api/discord/session') return reply({ disconnected:true });
    return reply({ rows:[], total:0 });
  } });
  await service.initialize();
  service.setSdk({ guildId:GUILD, commands:{
    authorize:async input => { commands.push(input); return { code:'authorized-code' }; },
    authenticate:async input => { assert.equal(input.access_token, 'discord-token'); return { user:{ id:USER } }; },
  } }, CLIENT);
  await service.connect();
  assert.equal(service.profile.name, 'Alice');
  assert.equal(service.connected, true);
  assert.deepEqual(commands[0].scope, ['identify','guilds.members.read']);
  await service.leaderboard();
  assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer application-token');
  assert.equal(JSON.stringify(service.profile).includes('token'), false);
  await service.disconnect(); assert.equal(service.connected, false);
  assert.throws(() => service.leaderboard(), /Connect/);
});

test('cancelled login, SDK mismatch and unavailable configuration do not invent a profile', async () => {
  const unavailable = createDiscordService({ fetchImpl:async () => reply({ configured:false }) });
  await unavailable.initialize();
  await assert.rejects(unavailable.connect(), /inside Discord/);
  unavailable.setSdk({ commands:{} }, CLIENT);
  await assert.rejects(unavailable.connect(), /not available/);
  assert.equal(unavailable.connected, false);
  const mismatch = createDiscordService({ fetchImpl:async (url, options) => url.endsWith('/config') ? reply({ configured:true })
    : options.method === 'DELETE' ? reply({ disconnected:true }) : reply({ token:'app-token', accessToken:'access', profile:{ id:USER, name:'Alice' } }) });
  await mismatch.initialize();
  mismatch.setSdk({ guildId:null, commands:{ authorize:async () => ({ code:'valid-code' }), authenticate:async () => ({ user:{ id:'someone-else' } }) } }, CLIENT);
  await assert.rejects(mismatch.connect(), /confirm your profile/);
  assert.equal(mismatch.connected, false);
  assert.equal(mismatch.busy, false);
});

test('connection status follows authorization, server verification and client confirmation', async t => {
  t.mock.timers.enable({ apis:['setTimeout'] });
  const authorization = deferred(), verification = deferred(), authentication = deferred();
  const service = createDiscordService({ fetchImpl:async url => url.endsWith('/config') ? reply({ configured:true }) : verification.promise });
  await service.initialize();
  service.setSdk({ commands:{ authorize:() => authorization.promise, authenticate:() => authentication.promise } }, CLIENT);
  const connection = service.connect();
  assert.equal(service.connectionStage, 'authorizing');
  assert.match(service.connectionMessage, /authorization window/);
  authorization.resolve({ code:'valid-code' }); await flush();
  assert.equal(service.connectionStage, 'verifying');
  assert.match(service.connectionMessage, /server access/);
  verification.resolve(reply({ token:'app-token', accessToken:'access', profile:{ id:USER, name:'Alice' } })); await flush();
  assert.equal(service.connectionStage, 'authenticating');
  assert.match(service.connectionMessage, /Discord to confirm/);
  assert.equal(service.connected, false, 'server verification alone must not connect the profile');
  authentication.resolve({ user:{ id:USER } }); await connection;
  assert.equal(service.connected, true);
  assert.equal(service.busy, false);
  assert.equal(service.connectionStage, '');
  assert.equal(service.connectionMessage, '');
  t.mock.timers.tick(60000);
  assert.equal(service.connectionError, '', 'successful commands must cancel their deadlines');
});

for (const stage of ['authorize', 'authenticate']) {
  test(`a stalled ${stage} releases Connect, ignores late replies and allows a verified retry`, async t => {
    t.mock.timers.enable({ apis:['setTimeout'] });
    const stale = deferred(), cleanup = deferred(), requests = [], changes = [];
    let attempt = 0;
    const retryUser = '223456789012345678';
    const service = createDiscordService({ fetchImpl:async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/config')) return reply({ configured:true });
      if (options.method === 'DELETE') return cleanup.promise;
      if (url.endsWith('/discord/session')) {
        const code = JSON.parse(options.body).code;
        return reply({ token:`app-${code}`, accessToken:`access-${code}`,
          profile:{ id:code === 'retry' ? retryUser : USER, name:code === 'retry' ? 'Retry player' : 'Stale player' } });
      }
      return reply({ rows:[], total:0 });
    } });
    await service.initialize();
    service.setSdk({ commands:{
      authorize:() => {
        attempt++;
        if (attempt === 1 && stage === 'authorize') return stale.promise;
        return Promise.resolve({ code:attempt === 1 ? 'stale' : 'retry' });
      },
      authenticate:() => attempt === 1 ? stale.promise : Promise.resolve({ user:{ id:retryUser } }),
    } }, CLIENT);
    service.subscribe(() => changes.push({ busy:service.busy, error:service.connectionError }));

    const failed = assert.rejects(service.connect(), stage === 'authorize' ? /authorization did not respond/ : /did not confirm/);
    await flush();
    assert.equal(service.busy, true);
    t.mock.timers.tick(stage === 'authorize' ? 60000 : 15000);
    await failed;
    assert.equal(service.busy, false, 'cleanup must not block retry even when DELETE stalls');
    assert.equal(service.connected, false);
    assert.equal(service.profile, null);
    assert.equal(service.connectionStage, '');
    assert.match(service.connectionError, /Connect profile.*reload/);
    assert.equal(changes.at(-1).busy, false, 'the UI must be notified that Connect is available again');
    assert.equal(changes.at(-1).error, service.connectionError);
    const deletions = requests.filter(request => request.options.method === 'DELETE');
    assert.equal(deletions.length, stage === 'authenticate' ? 1 : 0);
    if (deletions.length) assert.equal(deletions[0].options.headers.Authorization, 'Bearer app-stale');

    await service.connect();
    assert.equal(service.connectionError, '');
    assert.equal(service.profile.id, retryUser);
    assert.equal(service.profile.name, 'Retry player');
    const requestCount = requests.length;
    stale.resolve(stage === 'authorize' ? { code:'stale' } : { user:{ id:USER } });
    cleanup.resolve(reply({ error:'Session expired' }, 401));
    await flush();
    assert.equal(requests.length, requestCount, 'a late authorization must never exchange its code');
    assert.equal(service.profile.id, retryUser, 'a late response or cleanup must not replace or disconnect the retry');
    await service.leaderboard();
    assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer app-retry');
  });
}

test('avatar rendering accepts only HTTPS Discord CDN URLs', () => {
  assert.equal(discordAvatarUrl('javascript:alert(1)'), '');
  assert.equal(discordAvatarUrl('https://cdn.discordapp.com.evil.test/0.png'), '');
  assert.equal(discordAvatarUrl('http://cdn.discordapp.com/0.png'), '');
  assert.ok(discordAvatarUrl('https://cdn.discordapp.com/embed/avatars/0.png'));
});

test('mobile rotation uses Discord orientation locks without requiring profile sign-in', async () => {
  const calls = [], service = createDiscordService();
  service.setSdk({ platform:'mobile', commands:{ setOrientationLockState:async input => { calls.push(input); return {}; } } }, CLIENT);
  assert.equal(service.mobile, true);
  await service.setOrientation('landscape');
  await service.setOrientation('portrait');
  assert.deepEqual(calls, [
    { lock_state:3, picture_in_picture_lock_state:1, grid_lock_state:1 },
    { lock_state:2, picture_in_picture_lock_state:1, grid_lock_state:1 },
  ]);
  assert.equal(service.connected, false);
  await assert.rejects(service.setOrientation('invalid'), /Unknown screen orientation/);
  service.setSdk({ platform:'desktop', commands:{} }, CLIENT);
  assert.equal(service.mobile, false);
  await assert.rejects(service.setOrientation('landscape'), /Rotate your phone/);
  assert.equal(calls.length, 2);
});

test('a missing mobile rotation reply times out without holding profile connection busy', async t => {
  t.mock.timers.enable({ apis:['setTimeout'] });
  const service = createDiscordService();
  service.setSdk({ platform:'mobile', commands:{ setOrientationLockState:() => new Promise(() => {}) } }, CLIENT);
  const failed = assert.rejects(service.setOrientation('landscape'), /Rotate your phone/);
  t.mock.timers.tick(5000);
  await failed;
  assert.equal(service.busy, false);
});
