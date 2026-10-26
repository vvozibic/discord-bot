import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordAuth } from '../server/discord-auth.js';
import { createDiscordService, discordAvatarUrl } from '../src/discord-service.js';

const CLIENT = '1556624227212460092', USER = '123456789012345678', GUILD = '333333333333333333';
function reply(body, status = 200) { return { ok:status < 400, status, json:async () => body }; }

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

test('avatar rendering accepts only HTTPS Discord CDN URLs', () => {
  assert.equal(discordAvatarUrl('javascript:alert(1)'), '');
  assert.equal(discordAvatarUrl('https://cdn.discordapp.com.evil.test/0.png'), '');
  assert.equal(discordAvatarUrl('http://cdn.discordapp.com/0.png'), '');
  assert.ok(discordAvatarUrl('https://cdn.discordapp.com/embed/avatars/0.png'));
});
