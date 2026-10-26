import { isAbsolute, join, resolve, sep } from 'node:path';

const SNOWFLAKE = /^\d{15,22}$/;

/** Fail before opening an ephemeral database or accepting the wrong community. */
export function productionOptionsFromEnv(env = process.env) {
  function id(name) {
    const value = env[name]?.trim() || '';
    if (!SNOWFLAKE.test(value) || BigInt(value) <= 0n) throw new Error(`Set a valid ${name}.`);
    return value;
  }
  const clientId = id('DISCORD_CLIENT_ID'), allowedGuildId = id('GAME_ALLOWED_GUILD_ID');
  const betaRoleId = id('GAME_BETA_ROLE_ID');
  const adminRoles = (env.GAME_ADMIN_ROLE_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (adminRoles.some(value => !SNOWFLAKE.test(value) || BigInt(value) <= 0n)) throw new Error('Set valid GAME_ADMIN_ROLE_IDS.');
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim();
  if (!clientSecret) throw new Error('Set DISCORD_CLIENT_SECRET for the working bot application.');
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (env.RAILWAY_ENVIRONMENT_ID && (!mount || !isAbsolute(mount)))
    throw new Error('Attach a persistent Railway volume before starting the game.');
  const filename = env.GAME_DATABASE_PATH?.trim() || (mount ? join(mount, 'forest-trail.sqlite') : '');
  if (!filename || !isAbsolute(filename)) throw new Error('GAME_DATABASE_PATH must be an absolute path on persistent storage.');
  const databasePath = resolve(filename);
  if (mount && !databasePath.startsWith(resolve(mount) + sep))
    throw new Error('GAME_DATABASE_PATH must be inside the attached Railway volume.');
  const port = Number(env.PORT || 5179);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid PORT.');
  return {
    databasePath, clientId, clientSecret, allowedGuildId, allowedRoleIds:[betaRoleId, ...adminRoles],
    eventId:env.GAME_EVENT_ID || 'mindo-beta', eventName:env.GAME_EVENT_NAME || 'Mindo AI beta',
    host:env.GAME_BIND_HOST || '0.0.0.0', port,
  };
}
