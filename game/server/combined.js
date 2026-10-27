import { createProductionServer } from './main.js';
import { combinedOptionsFromEnv } from './combined-config.js';
import { createSqliteGameStore } from './game-store.js';
import { openPostgresGameStore } from './postgres-store.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createCombinedServer(env = process.env) {
  let { ready, missing, backend, options } = combinedOptionsFromEnv(env);
  let gameStore;
  try {
    if (ready) gameStore = backend === 'postgres' ? await openPostgresGameStore(options.databaseUrl)
      : createSqliteGameStore(options.databasePath, { eventId:options.eventId });
  } catch (error) {
    const code = /^[A-Z0-9_]{1,40}$/.test(error?.code ?? '') ? error.code : 'unavailable';
    console.warn(`Forest Trail storage initialization failed (${code}); connection details are not logged.`);
    ready = false;
    missing = [backend === 'postgres' ? 'GAME_DATABASE_CONNECTION' : 'GAME_STORAGE_WRITABLE'];
  }
  if (!ready) {
    options = { ...options, databasePath:':memory:', clientSecret:'' };
    gameStore = createSqliteGameStore(':memory:');
  }
  async function healthStatus() {
    let available = ready;
    if (available) { try { await gameStore.ping(); } catch { available = false; } }
    return { status:available ? 'ok' : 'needs_configuration', gameConfigured:available,
      missingConfiguration:ready && !available ? ['GAME_DATABASE_CONNECTION'] : missing,
      storageBackend:backend, botConfigured:undefined };
  }
  const server = createProductionServer({ ...options, gameStore, healthStatus });
  return { server, ready, missing, backend, port:options.port };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server, ready, missing, port } = await createCombinedServer();
  if (!ready) console.warn(`Forest Trail awaits server configuration: ${missing.join(', ')}`);
  server.listen(port, '127.0.0.1', () => console.log(`Forest Trail private service listening on 127.0.0.1:${port}; configured=${ready}`));
  for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => server.close());
}
