import { createProductionServer } from './main.js';
import { combinedOptionsFromEnv } from './combined-config.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createCombinedServer(env = process.env) {
  let { ready, missing, options } = combinedOptionsFromEnv(env);
  function open() {
    return createProductionServer({ ...options, healthStatus:{
      status:ready ? 'ok' : 'needs_configuration', gameConfigured:ready,
      missingConfiguration:missing, botConfigured:undefined,
    } });
  }
  let server;
  try { server = open(); }
  catch {
    ready = false;
    missing = ['GAME_STORAGE_WRITABLE'];
    options = { ...options, databasePath:':memory:', clientSecret:'' };
    server = open();
  }
  return { server, ready, missing, port:options.port };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server, ready, missing, port } = createCombinedServer();
  if (!ready) console.warn(`Forest Trail awaits server configuration: ${missing.join(', ')}`);
  server.listen(port, '127.0.0.1', () => console.log(`Forest Trail private service listening on 127.0.0.1:${port}; configured=${ready}`));
  for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => server.close());
}
