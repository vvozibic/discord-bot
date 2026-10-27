import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { combinedOptionsFromEnv } from '../server/combined-config.js';
import { createCombinedServer } from '../server/combined.js';

function configured(mount) {
  return { DISCORD_CLIENT_ID:'1466831420575186985', DISCORD_CLIENT_SECRET:'test-only-secret',
    RAILWAY_ENVIRONMENT_ID:'test', RAILWAY_VOLUME_MOUNT_PATH:mount, PORT:'8080', GAME_INTERNAL_PORT:'5199' };
}

test('combined deployment inherits bot scope and keeps game traffic on loopback', () => {
  const mount = join(tmpdir(), 'forest-config-test');
  const result = combinedOptionsFromEnv({ ...configured(mount), DISCORD_CLIENT_ID:'',
    FOREST_TRAIL_ACTIVITY_ID:'1466831420575186985', FOREST_TRAIL_GUILD_ID:'1400787114333044887',
    FOREST_TRAIL_BETA_ROLE_ID:'1564276225520963726', GAME_BIND_HOST:'0.0.0.0' });
  assert.equal(result.ready, true);
  assert.equal(result.options.host, '127.0.0.1');
  assert.equal(result.options.port, 5199);
  assert.equal(result.options.databasePath, join(mount, 'forest-trail.sqlite'));
  assert.equal(result.options.allowedGuildId, '1400787114333044887');
  assert.deepEqual(result.options.allowedRoleIds, ['1564276225520963726']);
  assert.equal(result.options.clientId, '1466831420575186985');
});

test('missing or invalid storage disables authorization instead of using ephemeral scores', () => {
  const mount = join(tmpdir(), 'forest-config-test');
  for (const change of [
    { RAILWAY_VOLUME_MOUNT_PATH:'' }, { GAME_DATABASE_PATH:join(mount, '..', 'ephemeral.sqlite') },
    { GAME_DATABASE_PATH:':memory:' }, { DISCORD_CLIENT_SECRET:'' }, { DISCORD_CLIENT_ID:'invalid' },
    { GAME_ADMIN_ROLE_IDS:'administrator' },
  ]) {
    const result = combinedOptionsFromEnv({ ...configured(mount), ...change });
    assert.equal(result.ready, false, JSON.stringify(change));
    assert.equal(result.options.clientSecret, '');
    assert.equal(result.options.databasePath, ':memory:');
    assert.ok(result.missing.length > 0);
  }
  assert.throws(() => combinedOptionsFromEnv({ GAME_INTERNAL_PORT:'invalid' }), /GAME_INTERNAL_PORT/);
});

async function withServer(env, run) {
  const result = createCombinedServer(env);
  await new Promise(resolve => result.server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${result.server.address().port}`, result); }
  finally { await new Promise(resolve => result.server.close(resolve)); }
}

test('unconfigured game stays reachable but cannot issue sessions or accept runs', async () => {
  await withServer({ DISCORD_CLIENT_SECRET:'must-not-be-exposed' }, async (base, result) => {
    assert.equal(result.ready, false);
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.status, 'needs_configuration');
    assert.equal(health.gameConfigured, false);
    assert.ok(health.missingConfiguration.includes('DISCORD_CLIENT_ID'));
    assert.equal(JSON.stringify(health).includes('must-not-be-exposed'), false);
    assert.equal((await (await fetch(`${base}/api/config`)).json()).configured, false);
    for (const path of ['/api/discord/session', '/api/runs'])
      assert.equal((await fetch(`${base}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{"code":"test-code"}' })).status, 503);
    assert.equal((await fetch(base)).status, 200);
  });
});

test('configured game exposes readiness and protects authenticated endpoints', async () => {
  const mount = mkdtempSync(join(tmpdir(), 'forest-combined-'));
  try {
    await withServer(configured(mount), async base => {
      const health = await (await fetch(`${base}/healthz`)).json();
      assert.equal(health.gameConfigured, true);
      assert.deepEqual(health.missingConfiguration, []);
      assert.equal((await fetch(`${base}/api/leaderboard`)).status, 401);
      assert.equal((await (await fetch(`${base}/api/config`)).json()).clientId, '1466831420575186985');
      for (const path of ['/.env', '/start.py', '/game/server/combined.js'])
        assert.equal((await fetch(`${base}${path}`)).status, 404);
    });
  } finally { rmSync(mount, { recursive:true, force:true }); }
});

test('unwritable storage leaves the bot-side web server usable and fails game access closed', async () => {
  const mount = mkdtempSync(join(tmpdir(), 'forest-combined-'));
  const filename = join(mount, 'not-a-file.sqlite');
  mkdirSync(filename);
  try {
    await withServer({ ...configured(mount), GAME_DATABASE_PATH:filename }, async (base, result) => {
      assert.equal(result.ready, false);
      assert.deepEqual(result.missing, ['GAME_STORAGE_WRITABLE']);
      assert.equal((await (await fetch(`${base}/api/config`)).json()).configured, false);
      assert.equal((await (await fetch(`${base}/healthz`)).json()).gameConfigured, false);
    });
  } finally { rmSync(mount, { recursive:true, force:true }); }
});
