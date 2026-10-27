import { isAbsolute, join, resolve, sep } from 'node:path';

export function databaseOptionsFromEnv(env = process.env) {
  const explicitUrl = env.GAME_DATABASE_URL?.trim();
  const sqliteSelected = Boolean(env.GAME_DATABASE_PATH?.trim() || env.RAILWAY_VOLUME_MOUNT_PATH?.trim());
  const sharedUrl = !sqliteSelected ? env.DATABASE_URL?.trim() : '';
  const databaseUrl = explicitUrl || sharedUrl;
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) throw new Error();
      return { backend:'postgres', databaseUrl, missing:[] };
    } catch { return { backend:'postgres', missing:[explicitUrl ? 'GAME_DATABASE_URL' : 'DATABASE_URL'] }; }
  }
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const filename = env.GAME_DATABASE_PATH?.trim() || (mount ? join(mount, 'forest-trail.sqlite') : '');
  const missing = [];
  if (env.RAILWAY_ENVIRONMENT_ID && (!mount || !isAbsolute(mount))) missing.push('RAILWAY_VOLUME_MOUNT_PATH');
  if (!filename || !isAbsolute(filename) || (mount && !resolve(filename).startsWith(resolve(mount) + sep)))
    missing.push('GAME_DATABASE_PATH');
  return { backend:'sqlite', ...(missing.length ? {} : { databasePath:resolve(filename) }), missing };
}
