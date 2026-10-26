import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';

// Explicit hosting environment values take precedence over ignored local files.
export function loadLocalEnvironment(root) {
  const local = {};
  for (const name of ['.env.server.local', '.env.bot.local']) {
    const file = resolve(root, name);
    if (existsSync(file)) Object.assign(local, parseEnv(readFileSync(file, 'utf8')));
  }
  for (const [key, value] of Object.entries(local)) if (process.env[key] === undefined) process.env[key] = value;
}

export function botOptionsFromEnv(env = process.env) {
  return {
    publicKey:env.DISCORD_PUBLIC_KEY || '', token:env.DISCORD_BOT_TOKEN || '', guildId:env.DISCORD_GUILD_ID || '',
    supportChannelId:env.DISCORD_SUPPORT_CHANNEL_ID || '', ticketToolApplicationId:env.DISCORD_TICKET_TOOL_ID || '',
    testChannelId:env.DISCORD_TEST_CHANNEL_ID || '',
  };
}
