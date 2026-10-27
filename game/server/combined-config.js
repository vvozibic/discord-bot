import { isAbsolute, join, resolve, sep } from 'node:path';
import { productionOptionsFromEnv } from './production-config.js';

const SNOWFLAKE = /^\d{15,22}$/;

/** Missing game setup must not take the existing Python bot offline. */
export function combinedOptionsFromEnv(env = process.env) {
  const internalPort = Number(env.GAME_INTERNAL_PORT || 5179);
  if (!Number.isInteger(internalPort) || internalPort < 1 || internalPort > 65535)
    throw new Error('Set a valid GAME_INTERNAL_PORT.');
  const normalized = {
    ...env,
    DISCORD_CLIENT_ID:env.DISCORD_CLIENT_ID?.trim() || env.FOREST_TRAIL_ACTIVITY_ID?.trim() || '',
    GAME_ALLOWED_GUILD_ID:(env.GAME_ALLOWED_GUILD_ID || env.FOREST_TRAIL_GUILD_ID || '1400787114333044887').trim(),
    GAME_BETA_ROLE_ID:(env.GAME_BETA_ROLE_ID || env.FOREST_TRAIL_BETA_ROLE_ID || '1564276225520963726').trim(),
    GAME_BIND_HOST:'127.0.0.1', PORT:String(internalPort),
  };
  const missing = [];
  for (const name of ['DISCORD_CLIENT_ID', 'GAME_ALLOWED_GUILD_ID', 'GAME_BETA_ROLE_ID'])
    if (!SNOWFLAKE.test(normalized[name]) || BigInt(normalized[name]) <= 0n) missing.push(name);
  if (!env.DISCORD_CLIENT_SECRET?.trim()) missing.push('DISCORD_CLIENT_SECRET');
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const filename = env.GAME_DATABASE_PATH?.trim() || (mount ? join(mount, 'forest-trail.sqlite') : '');
  if (env.RAILWAY_ENVIRONMENT_ID && (!mount || !isAbsolute(mount))) missing.push('RAILWAY_VOLUME_MOUNT_PATH');
  if (!filename || !isAbsolute(filename) || (mount && !resolve(filename).startsWith(resolve(mount) + sep)))
    missing.push('GAME_DATABASE_PATH');
  if ((env.GAME_ADMIN_ROLE_IDS || '').split(',').some(value => value.trim() && (!SNOWFLAKE.test(value.trim()) || BigInt(value.trim()) <= 0n)))
    missing.push('GAME_ADMIN_ROLE_IDS');
  const ready = missing.length === 0;
  const options = ready ? productionOptionsFromEnv(normalized) : {
    databasePath:':memory:', clientId:SNOWFLAKE.test(normalized.DISCORD_CLIENT_ID) ? normalized.DISCORD_CLIENT_ID : '',
    clientSecret:'', eventId:env.GAME_EVENT_ID || 'mindo-beta', eventName:env.GAME_EVENT_NAME || 'Mindo AI beta',
    host:'127.0.0.1', port:internalPort,
  };
  return { ready, missing, options };
}
