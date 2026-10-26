import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { botCommands } from '../server/bot/commands.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{15,22}$/;
export const BOT_INSTALL_PERMISSIONS = '125952'; // View Channel, Send Messages, Manage Messages, Embed Links, Attach Files, Read Message History.

export class BotSetupError extends Error {}

/** Local bot settings override server-file defaults; the calling environment always wins. */
export async function loadBotEnvironment({ root = projectRoot, env = process.env } = {}) {
  const fromFiles = {};
  for (const name of ['.env.server.local', '.env.bot.local']) {
    try { Object.assign(fromFiles, parseEnv(await readFile(resolve(root, name), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw new BotSetupError(`Cannot read ${name}; check the local file.`); }
  }
  return { ...fromFiles, ...env };
}

export function createRegistrationPlan({ env, global = false } = {}) {
  if (!SNOWFLAKE.test(env?.DISCORD_CLIENT_ID ?? '')) throw new BotSetupError('Set a valid DISCORD_CLIENT_ID.');
  if (!global && !SNOWFLAKE.test(env.DISCORD_GUILD_ID ?? '')) throw new BotSetupError('Set a valid DISCORD_GUILD_ID, or explicitly use --global.');
  const testChannelId = env.DISCORD_TEST_CHANNEL_ID ?? '';
  const testMode = testChannelId !== '';
  if (testMode && !SNOWFLAKE.test(testChannelId)) throw new BotSetupError('Set a valid DISCORD_TEST_CHANNEL_ID, or leave it empty for production commands.');
  const applicationId = env.DISCORD_CLIENT_ID;
  const commands = botCommands().map(command => {
    const scopedCommand = testMode ? { ...command, default_member_permissions:'8' } : command;
    if (global) return scopedCommand;
    const { contexts, integration_types, dm_permission, ...guildCommand } = scopedCommand;
    return guildCommand;
  });
  const invite = new URL('https://discord.com/oauth2/authorize');
  invite.search = new URLSearchParams({ client_id:applicationId, scope:'bot applications.commands', permissions:BOT_INSTALL_PERMISSIONS,
    integration_type:'0', ...(!global ? { guild_id:env.DISCORD_GUILD_ID, disable_guild_select:'true' } : {}) }).toString();
  return {
    scope:global ? 'global' : 'guild', applicationId, ...(global ? {} : { guildId:env.DISCORD_GUILD_ID }),
    endpoint:`${API}/applications/${applicationId}${global ? '' : `/guilds/${env.DISCORD_GUILD_ID}`}/commands`,
    commands, inviteUrl:invite.toString(),
  };
}

export async function registerBotCommands({ env, global = false, fetchImpl = fetch, timeoutMs = 10000, waitImpl = wait } = {}) {
  const plan = createRegistrationPlan({ env, global });
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!token) throw new BotSetupError('Set DISCORD_BOT_TOKEN to apply command registration.');
  async function request(url, { method = 'GET', body } = {}) {
    const serializedBody = body ? JSON.stringify(body) : undefined;
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, { method, redirect:'error', signal:AbortSignal.timeout(timeoutMs),
          headers:{ Authorization:`Bot ${token}`, ...(body ? { 'Content-Type':'application/json' } : {}) },
          ...(body ? { body:serializedBody } : {}),
        });
      } catch { throw new BotSetupError('Discord request failed or timed out. Check connectivity and configuration.'); }
      if (response.status === 429) {
        if (attempt === 3) throw new BotSetupError('Discord rate limit persists (HTTP 429) after 3 retries. Wait before rerunning --apply.');
        let retryAfter;
        // Inspect only the documented delay field; never include API bodies in output.
        try { const payload = await response.json(); retryAfter = payload?.retry_after; } catch {}
        if (typeof retryAfter !== 'number') retryAfter = Number(response.headers?.get('Retry-After'));
        if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
          throw new BotSetupError('Discord rate limited the request (HTTP 429) without a valid retry delay. Wait before rerunning --apply.');
        }
        if (retryAfter > 30) throw new BotSetupError('Discord rate limited the request (HTTP 429) for longer than 30 seconds. Wait for the rate limit to clear before rerunning --apply.');
        try { await waitImpl(Math.ceil(retryAfter * 1000)); }
        catch { throw new BotSetupError('Discord retry wait failed. Wait before rerunning --apply.'); }
        continue;
      }
      if (!response.ok) throw new BotSetupError(`Discord rejected the request (HTTP ${Number(response.status) || 'unknown'}). Check credentials, permissions, and rate limits.`);
      return response;
    }
  }

  // A token for another application must never modify the configured application's commands.
  const identityResponse = await request(`${API}/oauth2/applications/@me`);
  let identity;
  try { identity = await identityResponse.json(); }
  catch { throw new BotSetupError('Discord returned an invalid application identity. No commands were registered.'); }
  if (identity?.id !== plan.applicationId) throw new BotSetupError('The bot token belongs to a different application. No commands were registered.');

  let completed = 0;
  for (const command of plan.commands) {
    try { await request(plan.endpoint, { method:'POST', body:command }); }
    catch (error) {
      throw new BotSetupError(`${error.message} Registered ${completed} of ${plan.commands.length} commands; rerun --apply after resolving the issue.`);
    }
    completed += 1;
  }
  return { ...plan, registered:completed };
}

export async function main({ argv = process.argv.slice(2), env, output = console.log, fetchImpl = fetch } = {}) {
  if (argv.some(argument => !['--apply', '--global', '--help'].includes(argument))) throw new BotSetupError('Unknown option. Use --help for command registration usage.');
  if (argv.includes('--help')) {
    output('Usage: node scripts/register-bot-commands.js [--global] [--apply]\nDefault: print a dry-run manifest and bot invite URL. --apply upserts only these slash commands.');
    return;
  }
  const config = env ?? await loadBotEnvironment();
  const plan = createRegistrationPlan({ env:config, global:argv.includes('--global') });
  if (argv.includes('--apply')) {
    const result = await registerBotCommands({ env:config, global:argv.includes('--global'), fetchImpl });
    output(`Registered ${result.registered} ${result.scope} slash commands. Existing unrelated commands and the Activity entry point were retained.`);
  } else {
    output(`Dry run: ${plan.commands.length} ${plan.scope} slash commands. No Discord requests were sent.`);
    output(JSON.stringify({ method:'POST (one request per command)', endpoint:plan.endpoint, commands:plan.commands }, null, 2));
  }
  output(`Bot invite URL: ${plan.inviteUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof BotSetupError ? error.message : 'Bot command setup failed. Check local configuration and connectivity.');
    process.exitCode = 1;
  });
}
