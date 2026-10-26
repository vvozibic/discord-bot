import { resolve } from 'node:path';
import { createGameApi } from './api.js';
import { botOptionsFromEnv, loadLocalEnvironment } from './bot/config.js';

export function gameApiPlugin(root, env) {
  let api;
  function install(server) {
    loadLocalEnvironment(root);
    api = createGameApi({ databasePath:process.env.GAME_DATABASE_PATH || resolve(root, '.data', 'leaderboard.sqlite'),
      clientId:process.env.DISCORD_CLIENT_ID || env.VITE_DISCORD_CLIENT_ID,
      clientSecret:process.env.DISCORD_CLIENT_SECRET,
      eventId:process.env.GAME_EVENT_ID || 'tag', eventName:process.env.GAME_EVENT_NAME || 'TAG campaign', botApiKey:process.env.GAME_BOT_API_KEY || '', bot:botOptionsFromEnv() });
    server.middlewares.use(api.handle);
    server.httpServer?.once('close', () => { api?.close(); api = null; });
  }
  return { name:'forest-trail-api', configureServer:install, configurePreviewServer:install };
}
