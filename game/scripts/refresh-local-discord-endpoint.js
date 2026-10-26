import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadBotEnvironment } from './register-bot-commands.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const APPLICATION_API = 'https://discord.com/api/v10/applications/@me';
const SNOWFLAKE = /^\d{15,22}$/;

export class LocalEndpointSetupError extends Error {}

function sameRoot(left, right) {
  const normalize = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  return normalize(left) === normalize(right);
}

export function createLocalEndpointPlan({ env, runtime, root = projectRoot } = {}) {
  if (!SNOWFLAKE.test(env?.DISCORD_CLIENT_ID ?? '')) throw new LocalEndpointSetupError('Set a valid DISCORD_CLIENT_ID before refreshing the local endpoint.');
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) || runtime.schemaVersion !== 1
    || typeof runtime.projectRoot !== 'string' || !sameRoot(runtime.projectRoot, root)) {
    throw new LocalEndpointSetupError('Local bot runtime must use schemaVersion 1 and belong to this project. Restart the local launcher.');
  }
  let tunnel;
  try { tunnel = new URL(runtime.publicUrl); } catch { throw new LocalEndpointSetupError('Local runtime requires a valid HTTPS trycloudflare.com tunnel origin.'); }
  if (typeof runtime.publicUrl !== 'string' || /[\u0000-\u0020\u007f?#]/.test(runtime.publicUrl)
    || tunnel.protocol !== 'https:' || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+trycloudflare\.com$/.test(tunnel.hostname)
    || tunnel.username || tunnel.password || tunnel.port || tunnel.pathname !== '/' || tunnel.search || tunnel.hash) {
    throw new LocalEndpointSetupError('Local runtime requires a credential-free HTTPS trycloudflare.com tunnel origin without a path, query, or fragment.');
  }
  return { applicationId:env.DISCORD_CLIENT_ID, endpointUrl:`${tunnel.origin}/api/discord/interactions` };
}

export async function loadLocalBotRuntime({ root = projectRoot } = {}) {
  try { return JSON.parse(await readFile(resolve(root, '.local-bot-runtime.json'), 'utf8')); }
  catch { throw new LocalEndpointSetupError('Cannot read a valid .local-bot-runtime.json. Start the local bot launcher first.'); }
}

/** Only --apply may contact Discord. Activity URL mappings still require the Developer Portal. */
export async function refreshLocalDiscordEndpoint({ env, runtime, root = projectRoot, apply = false, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const plan = createLocalEndpointPlan({ env, runtime, root });
  if (!apply) return { ...plan, status:'dry-run' };
  if (!/^[\da-f]{64}$/i.test(env.DISCORD_PUBLIC_KEY ?? '')) throw new LocalEndpointSetupError('Set a valid DISCORD_PUBLIC_KEY before refreshing the local endpoint.');
  const token = typeof env.DISCORD_BOT_TOKEN === 'string' ? env.DISCORD_BOT_TOKEN.trim() : '';
  if (!token) throw new LocalEndpointSetupError('Set DISCORD_BOT_TOKEN before refreshing the local endpoint.');

  async function request(method, body) {
    let response;
    try {
      response = await fetchImpl(APPLICATION_API, { method, redirect:'error', signal:AbortSignal.timeout(timeoutMs),
        headers:{ Authorization:`Bot ${token}`, ...(body ? { 'Content-Type':'application/json' } : {}) },
        ...(body ? { body:JSON.stringify(body) } : {}),
      });
    } catch { throw new LocalEndpointSetupError('Discord endpoint refresh failed or timed out. Check connectivity and bot configuration.'); }
    if (!response.ok) throw new LocalEndpointSetupError(`Discord rejected the endpoint refresh (HTTP ${Number(response.status) || 'unknown'}). Check bot credentials and endpoint availability; retry later if rate limited.`);
    try { return await response.json(); }
    catch { throw new LocalEndpointSetupError('Discord returned an invalid application response. Check the application settings before retrying.'); }
  }

  const current = await request('GET');
  if (current?.id !== plan.applicationId) throw new LocalEndpointSetupError('The bot token belongs to a different application. No endpoint was changed.');
  if (current.interactions_endpoint_url === plan.endpointUrl) return { ...plan, status:'unchanged' };
  const updated = await request('PATCH', { interactions_endpoint_url:plan.endpointUrl });
  if (updated?.id !== plan.applicationId || updated.interactions_endpoint_url !== plan.endpointUrl) {
    throw new LocalEndpointSetupError('Discord did not confirm the expected endpoint update. Check the application settings before retrying.');
  }
  return { ...plan, status:'updated' };
}

export async function main({ argv = process.argv.slice(2), env, runtime, root = projectRoot, output = console.log, fetchImpl = fetch } = {}) {
  if (argv.some(argument => !['--apply', '--help'].includes(argument))) throw new LocalEndpointSetupError('Unknown option. Use --help for local endpoint refresh usage.');
  if (argv.includes('--help')) {
    output('Usage: node scripts/refresh-local-discord-endpoint.js [--apply]\nDefault: preview the local interaction endpoint without contacting Discord. --apply updates only a changed interaction endpoint after checking the bot application identity.');
    return;
  }
  const result = await refreshLocalDiscordEndpoint({ env:env ?? await loadBotEnvironment({ root }),
    runtime:runtime ?? await loadLocalBotRuntime({ root }), root, apply:argv.includes('--apply'), fetchImpl });
  if (result.status === 'dry-run') output(`Dry run: application ${result.applicationId} interaction endpoint would be ${result.endpointUrl}. No Discord requests were sent.`);
  else if (result.status === 'unchanged') output(`Discord interaction endpoint is already current: ${result.endpointUrl}`);
  else output(`Discord interaction endpoint updated: ${result.endpointUrl}`);
  output('Activity root URL mapping must be checked separately in the Discord Developer Portal.');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof LocalEndpointSetupError ? error.message : 'Local Discord endpoint refresh failed. Check local configuration and connectivity.');
    process.exitCode = 1;
  });
}
