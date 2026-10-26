import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { productionOptionsFromEnv } from '../server/production-config.js';

const mount = join(tmpdir(), 'forest-production-volume');
const env = {
  DISCORD_CLIENT_ID:'1470503084164644946', DISCORD_CLIENT_SECRET:'ci-only-client-secret',
  GAME_ALLOWED_GUILD_ID:'1400787114333044887', GAME_BETA_ROLE_ID:'1564276225520963726',
  RAILWAY_ENVIRONMENT_ID:'ci', RAILWAY_VOLUME_MOUNT_PATH:mount,
};

test('Railway starts only with an explicit community and a database inside its persistent volume', () => {
  const config = productionOptionsFromEnv(env);
  assert.equal(config.databasePath, join(mount, 'forest-trail.sqlite'));
  assert.equal(config.clientId, env.DISCORD_CLIENT_ID);
  assert.deepEqual(config.allowedRoleIds, [env.GAME_BETA_ROLE_ID]);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 5179);
  assert.equal(config.eventId, 'mindo-beta');
  assert.equal(config.bot, undefined, 'the deployed service does not create a second HTTP bot');
});

test('missing volume, ephemeral paths and invalid identity or role configuration fail closed', () => {
  for (const change of [
    { RAILWAY_VOLUME_MOUNT_PATH:'' }, { GAME_DATABASE_PATH:':memory:' },
    { GAME_DATABASE_PATH:'./scores.sqlite' }, { GAME_DATABASE_PATH:join(mount, '..', 'lost.sqlite') },
    { DISCORD_CLIENT_ID:'' }, { DISCORD_CLIENT_SECRET:'' }, { GAME_ALLOWED_GUILD_ID:'' },
    { GAME_BETA_ROLE_ID:'0' }, { GAME_ADMIN_ROLE_IDS:'administrator' }, { PORT:'NaN' }, { PORT:'65536' },
  ]) assert.throws(() => productionOptionsFromEnv({ ...env, ...change }), JSON.stringify(change));
  const config = productionOptionsFromEnv({ ...env, GAME_ADMIN_ROLE_IDS:'1421173887848157257' });
  assert.deepEqual(config.allowedRoleIds, [env.GAME_BETA_ROLE_ID, '1421173887848157257']);
});
