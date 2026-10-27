import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { databaseOptionsFromEnv } from '../server/database-config.js';
import { productionOptionsFromEnv } from '../server/production-config.js';
import { combinedOptionsFromEnv } from '../server/combined-config.js';
import { openPostgresGameStore } from '../server/postgres-store.js';

const URL = 'postgresql://test_user:test-only-password@127.0.0.1:5432/existing_bot';
const oauth = { DISCORD_CLIENT_ID:'1466831420575186985', DISCORD_CLIENT_SECRET:'test-only-oauth',
  GAME_ALLOWED_GUILD_ID:'1400787114333044887', GAME_BETA_ROLE_ID:'1564276225520963726', RAILWAY_ENVIRONMENT_ID:'test' };

test('an existing bot PostgreSQL URL is reused without requiring a filesystem volume', () => {
  const env = { ...oauth, DATABASE_URL:URL };
  assert.deepEqual(databaseOptionsFromEnv(env), { backend:'postgres', databaseUrl:URL, missing:[] });
  const config = combinedOptionsFromEnv(env);
  assert.equal(config.ready, true);
  assert.equal(config.backend, 'postgres');
  assert.equal(config.options.databaseUrl, URL);
  assert.equal(config.options.databasePath, undefined);
  assert.equal(productionOptionsFromEnv(env).databaseUrl, URL);
});

test('existing explicit SQLite storage wins over automatic shared-database discovery', () => {
  const mount = join(tmpdir(), 'forest-existing-volume');
  const env = { ...oauth, DATABASE_URL:URL, RAILWAY_VOLUME_MOUNT_PATH:mount };
  const config = combinedOptionsFromEnv(env);
  assert.equal(config.ready, true);
  assert.equal(config.backend, 'sqlite');
  assert.equal(config.options.databasePath, join(mount, 'forest-trail.sqlite'));
  assert.equal(config.options.databaseUrl, undefined);
  const selected = databaseOptionsFromEnv({ DATABASE_URL:URL, GAME_DATABASE_PATH:join(mount, 'existing.sqlite') });
  assert.equal(selected.backend, 'sqlite');
});

test('a separate database URL is an explicit override and unsupported URLs fail closed', () => {
  const config = combinedOptionsFromEnv({ ...oauth, DATABASE_URL:'invalid', GAME_DATABASE_URL:URL,
    GAME_DATABASE_PATH:':memory:' });
  assert.equal(config.ready, true);
  assert.equal(config.options.databaseUrl, URL);
  for (const value of ['https://example.invalid/database', 'postgresql:///no-host', 'not-a-url']) {
    const failed = combinedOptionsFromEnv({ ...oauth, GAME_DATABASE_URL:value });
    assert.equal(failed.ready, false);
    assert.deepEqual(failed.missing, ['GAME_DATABASE_URL']);
    assert.equal(failed.options.clientSecret, '');
  }
});

test('missing both database backends retains the existing fail-closed behavior', () => {
  const result = combinedOptionsFromEnv(oauth);
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes('RAILWAY_VOLUME_MOUNT_PATH'));
  assert.ok(result.missing.includes('GAME_DATABASE_PATH'));
});

test('database initialization failures close the pool and do not disclose its credentials', async () => {
  let ended = false;
  class FailedPool {
    on() {}
    async connect() { throw new Error(`Do not expose ${URL}`); }
    async end() { ended = true; }
  }
  await assert.rejects(openPostgresGameStore(URL, { PoolClass:FailedPool }), error => {
    assert.equal(error.message.includes('test-only-password'), false);
    assert.equal(error.message.includes(URL), false);
    return true;
  });
  assert.equal(ended, true);
});
