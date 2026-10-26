import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { botCommands } from '../server/bot/commands.js';
import { BOT_INSTALL_PERMISSIONS, createRegistrationPlan, loadBotEnvironment, main, registerBotCommands } from '../scripts/register-bot-commands.js';

const applicationId = '123456789012345678';
const guildId = '234567890123456789';
const env = { DISCORD_CLIENT_ID:applicationId, DISCORD_GUILD_ID:guildId, DISCORD_BOT_TOKEN:'private-fixture-token' };
const identity = () => ({ ok:true, json:async () => ({ id:applicationId }) });

test('slash manifest is guild-only, preserves Activity entry point, and restricts setup', () => {
  const commands = botCommands();
  assert.deepEqual(commands.map(command => command.name), ['play', 'participate', 'trail-ranking', 'trail-profile', 'support', 'bot-setup']);
  for (const command of commands) {
    assert.equal(command.type, 1);
    assert.equal(command.dm_permission, false);
    assert.deepEqual(command.contexts, [0]);
    assert.deepEqual(command.integration_types, [0]);
  }
  const setup = commands.find(command => command.name === 'bot-setup');
  assert.equal(setup.default_member_permissions, '32');
  assert.deepEqual(setup.options.map(option => option.name), ['game-panel', 'support-card', 'support-update', 'support-hide', 'support-restore']);
  for (const subcommand of setup.options) {
    let sawOptional = false;
    for (const option of subcommand.options ?? []) {
      if (!option.required) sawOptional = true;
      assert.ok(!(sawOptional && option.required), 'Discord requires required options before optional ones');
    }
  }
  const createCard = setup.options.find(option => option.name === 'support-card');
  assert.deepEqual(createCard.options.map(option => [option.name, option.required]), [['text', true], ['title', false], ['image', false]]);
  assert.equal(createCard.options[0].max_length, 4000);
  assert.match(setup.options.find(option => option.name === 'support-hide').description, /Ticket Tool/);
  assert.match(setup.options.find(option => option.name === 'support-restore').description, /Ticket Tool/);
});

test('manifest callers cannot mutate later registration plans', () => {
  botCommands()[0].contexts.push(1);
  botCommands()[5].options[0].name = 'changed';
  assert.deepEqual(botCommands()[0].contexts, [0]);
  assert.equal(botCommands()[5].options[0].name, 'game-panel');
});

test('guild plan uses individual command endpoint and a scoped least-permission invite', () => {
  const plan = createRegistrationPlan({ env });
  assert.equal(plan.endpoint, `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`);
  assert.ok(plan.commands.every(command => !('contexts' in command) && !('integration_types' in command) && !('dm_permission' in command)));
  const invite = new URL(plan.inviteUrl);
  assert.equal(invite.searchParams.get('scope'), 'bot applications.commands');
  assert.equal(invite.searchParams.get('permissions'), BOT_INSTALL_PERMISSIONS);
  assert.equal(BOT_INSTALL_PERMISSIONS, '125952');
  assert.equal(invite.searchParams.get('guild_id'), guildId);
  assert.equal(invite.searchParams.get('disable_guild_select'), 'true');
  assert.equal(BigInt(BOT_INSTALL_PERMISSIONS) & 8n, 0n, 'bot does not request Administrator');
  assert.equal(BigInt(BOT_INSTALL_PERMISSIONS) & 8192n, 8192n, 'Manage Messages is needed to suppress another bot\'s embed');
  assert.equal(BigInt(BOT_INSTALL_PERMISSIONS) & 32768n, 32768n, 'Attach Files is needed for durable support image uploads');
});

test('global registration is explicit and still restricted to guild contexts', () => {
  assert.throws(() => createRegistrationPlan({ env:{ DISCORD_CLIENT_ID:applicationId } }), /DISCORD_GUILD_ID/);
  const plan = createRegistrationPlan({ env:{ DISCORD_CLIENT_ID:applicationId }, global:true });
  assert.equal(plan.endpoint, `https://discord.com/api/v10/applications/${applicationId}/commands`);
  assert.ok(plan.commands.every(command => command.dm_permission === false && command.contexts[0] === 0));
  assert.throws(() => createRegistrationPlan({ env:{ ...env, DISCORD_CLIENT_ID:'bad' } }), /DISCORD_CLIENT_ID/);
});

test('test mode restricts all six commands to Administrator without changing production defaults', async () => {
  const testEnv = { ...env, DISCORD_TEST_CHANNEL_ID:'345678901234567890' };
  for (const global of [false, true]) {
    const plan = createRegistrationPlan({ env:testEnv, global });
    assert.equal(plan.commands.length, 6);
    assert.ok(plan.commands.every(command => command.type === 1 && command.default_member_permissions === '8'));
    assert.deepEqual(plan.commands.map(command => command.name), botCommands().map(command => command.name));
    if (global) assert.ok(plan.commands.every(command => command.contexts.length === 1 && command.contexts[0] === 0));
  }
  const registered = [];
  await registerBotCommands({ env:testEnv, fetchImpl:async (url, options) => {
    if (options.method === 'GET') return identity();
    assert.equal(options.method, 'POST');
    registered.push(JSON.parse(options.body));
    return { ok:true, status:200 };
  } });
  assert.equal(registered.length, 6);
  assert.ok(registered.every(command => command.default_member_permissions === '8'));
  for (const productionEnv of [env, { ...env, DISCORD_TEST_CHANNEL_ID:'' }]) {
    const production = createRegistrationPlan({ env:productionEnv });
    assert.ok(production.commands.slice(0, 5).every(command => command.default_member_permissions === undefined));
    assert.equal(production.commands[5].default_member_permissions, '32');
  }
  assert.equal(botCommands()[5].default_member_permissions, '32');
});

test('invalid nonempty test channel ID fails before any network request', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; assert.fail('invalid test configuration must not contact Discord'); };
  for (const value of [' ', 'invalid', '123', 'https://discord.com/channels/123/456']) {
    const invalidEnv = { ...env, DISCORD_TEST_CHANNEL_ID:value };
    assert.throws(() => createRegistrationPlan({ env:invalidEnv }), /DISCORD_TEST_CHANNEL_ID/);
    await assert.rejects(registerBotCommands({ env:invalidEnv, fetchImpl }), /DISCORD_TEST_CHANNEL_ID/);
    await assert.rejects(main({ argv:['--apply'], env:invalidEnv, output:() => {}, fetchImpl }), /DISCORD_TEST_CHANNEL_ID/);
    await assert.rejects(registerBotCommands({ env:invalidEnv, global:true, fetchImpl }), /DISCORD_TEST_CHANNEL_ID/);
  }
  assert.equal(requests, 0);
});

test('local bot values override server-file defaults while injected environment wins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forest-bot-env-'));
  try {
    await writeFile(join(root, '.env.server.local'), 'DISCORD_CLIENT_ID=server\nSERVER_ONLY=value\nDISCORD_BOT_TOKEN=server-token\n');
    await writeFile(join(root, '.env.bot.local'), 'DISCORD_CLIENT_ID=bot\nBOT_ONLY="bot value"\nDISCORD_BOT_TOKEN=file-token\n');
    const injected = { DISCORD_BOT_TOKEN:'injected-token' };
    const loaded = await loadBotEnvironment({ root, env:injected });
    assert.equal(loaded.DISCORD_CLIENT_ID, 'bot');
    assert.equal(loaded.DISCORD_BOT_TOKEN, 'injected-token');
    assert.equal(loaded.SERVER_ONLY, 'value');
    assert.equal(loaded.BOT_ONLY, 'bot value');
    assert.deepEqual(injected, { DISCORD_BOT_TOKEN:'injected-token' });
    assert.deepEqual(await loadBotEnvironment({ root:join(root, 'absent'), env:{} }), {});
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('CLI defaults to dry run without token or network requests and never prints credentials', async () => {
  const lines = [];
  await main({ argv:[], env, output:line => lines.push(line), fetchImpl:async () => { assert.fail('dry run must not contact Discord'); } });
  const output = lines.join('\n');
  assert.match(output, /Dry run/);
  assert.match(output, /Bot invite URL/);
  assert.match(output, /"name": "play"/);
  assert.ok(!output.includes(env.DISCORD_BOT_TOKEN));
  await main({ argv:[], env:{ DISCORD_CLIENT_ID:applicationId, DISCORD_GUILD_ID:guildId }, output:() => {} });
});

test('apply validates bot identity before six individual POST upserts, never bulk overwrites', async () => {
  const calls = [];
  const result = await registerBotCommands({ env, fetchImpl:async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, `Bot ${env.DISCORD_BOT_TOKEN}`);
    return calls.length === 1 ? identity() : { ok:true, status:201 };
  } });
  assert.equal(result.registered, 6);
  assert.equal(calls[0].url, 'https://discord.com/api/v10/oauth2/applications/@me');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls.length, 7);
  assert.deepEqual(calls.slice(1).map(call => JSON.parse(call.options.body).name), botCommands().map(command => command.name));
  assert.ok(calls.slice(1).every(call => call.options.method === 'POST' && call.url.endsWith(`/guilds/${guildId}/commands`)));
});

test('token application mismatch prevents all command mutations', async () => {
  let requests = 0;
  await assert.rejects(registerBotCommands({ env, fetchImpl:async () => {
    requests += 1;
    return { ok:true, json:async () => ({ id:'345678901234567890' }) };
  } }), /different application/);
  assert.equal(requests, 1);
});

test('missing credentials and invalid identity JSON cannot mutate commands', async () => {
  await assert.rejects(registerBotCommands({ env:{ ...env, DISCORD_BOT_TOKEN:'' }, fetchImpl:async () => assert.fail('missing token') }), /DISCORD_BOT_TOKEN/);
  let requests = 0;
  await assert.rejects(registerBotCommands({ env, fetchImpl:async () => {
    requests += 1;
    return { ok:true, json:async () => { throw new Error('private body'); } };
  } }), /invalid application identity/);
  assert.equal(requests, 1);
});

test('API and transport failures redact response bodies, tokens, and underlying error details', async () => {
  await assert.rejects(registerBotCommands({ env, fetchImpl:async () => ({
    ok:false, status:401, json:async () => assert.fail('do not parse error bodies'), text:async () => assert.fail('do not read error bodies'),
  }) }), error => error.message.includes('HTTP 401') && !error.message.includes(env.DISCORD_BOT_TOKEN));
  await assert.rejects(registerBotCommands({ env, fetchImpl:async () => { throw new Error(`transport contains ${env.DISCORD_BOT_TOKEN}`); } }), error => {
    assert.match(error.message, /failed or timed out/);
    assert.ok(!error.message.includes(env.DISCORD_BOT_TOKEN));
    return true;
  });
});

test('partial registration stops at failure and reports safe resumable progress', async () => {
  let requests = 0;
  await assert.rejects(registerBotCommands({ env, fetchImpl:async () => {
    requests += 1;
    if (requests === 1) return identity();
    return requests === 4 ? { ok:false, status:429 } : { ok:true };
  } }), /HTTP 429.*Registered 2 of 6 commands/);
  assert.equal(requests, 4);
});

test('429 retries only the exact pending command with its original body and counts progress once', async () => {
  const calls = [], waits = [];
  const result = await registerBotCommands({ env, waitImpl:async milliseconds => waits.push(milliseconds), fetchImpl:async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === 'GET') return identity();
    if (calls.length === 7) return { ok:false, status:429, json:async () => ({ retry_after:0.25, private:env.DISCORD_BOT_TOKEN }) };
    return { ok:true, status:200 };
  } });
  assert.equal(result.registered, 6);
  assert.deepEqual(waits, [250]);
  assert.equal(calls.length, 8);
  assert.deepEqual(calls.slice(1).map(call => JSON.parse(call.body).name), ['play', 'participate', 'trail-ranking', 'trail-profile', 'support', 'bot-setup', 'bot-setup']);
  assert.equal(calls[6].body, calls[7].body);
  assert.equal(calls[6].url, calls[7].url);
  assert.equal(calls[6].headers.Authorization, calls[7].headers.Authorization);
  assert.notEqual(calls[6].signal, calls[7].signal, 'retry receives a fresh timeout');
});

test('429 respects Retry-After seconds when JSON delay is unavailable', async () => {
  const waits = [];
  let requests = 0;
  const result = await registerBotCommands({ env, waitImpl:async milliseconds => waits.push(milliseconds), fetchImpl:async () => {
    requests += 1;
    if (requests === 1) return { ok:false, status:429, json:async () => { throw new Error(env.DISCORD_BOT_TOKEN); }, headers:{ get:name => name === 'Retry-After' ? '1.125' : null } };
    return requests === 2 ? identity() : { ok:true, status:200 };
  } });
  assert.equal(result.registered, 6);
  assert.deepEqual(waits, [1125]);
  assert.equal(requests, 8);
});

test('429 stops safely after three retries without overstating completed commands or exposing bodies', async () => {
  const waits = [], names = [];
  await assert.rejects(registerBotCommands({ env, waitImpl:async milliseconds => waits.push(milliseconds), fetchImpl:async (url, options) => {
    if (options.method === 'GET') return identity();
    const name = JSON.parse(options.body).name;
    names.push(name);
    return name === 'bot-setup'
      ? { ok:false, status:429, json:async () => ({ retry_after:1, private:env.DISCORD_BOT_TOKEN }) }
      : { ok:true, status:200 };
  } }), error => {
    assert.match(error.message, /HTTP 429.*after 3 retries.*Registered 5 of 6 commands/);
    assert.ok(!error.message.includes(env.DISCORD_BOT_TOKEN));
    return true;
  });
  assert.deepEqual(waits, [1000, 1000, 1000]);
  assert.deepEqual(names, ['play', 'participate', 'trail-ranking', 'trail-profile', 'support', 'bot-setup', 'bot-setup', 'bot-setup', 'bot-setup']);
});

test('429 invalid or excessive delays stop without waiting or hammering Discord', async () => {
  for (const retryAfter of [0, -1, NaN, Infinity, 30.001, 3600]) {
    let requests = 0;
    await assert.rejects(registerBotCommands({ env, waitImpl:async () => assert.fail('invalid or long delay must not wait'), fetchImpl:async () => {
      requests += 1;
      return { ok:false, status:429, json:async () => ({ retry_after:retryAfter, private:env.DISCORD_BOT_TOKEN }) };
    } }), error => {
      assert.match(error.message, /HTTP 429.*Wait/);
      assert.ok(!error.message.includes(env.DISCORD_BOT_TOKEN));
      return true;
    });
    assert.equal(requests, 1);
  }
});

test('unknown flags fail before any request; help needs no configuration', async () => {
  await assert.rejects(main({ argv:['--overwrite'], env:{}, fetchImpl:async () => assert.fail('unknown option') }), /Unknown option/);
  const lines = [];
  await main({ argv:['--help'], env:{}, output:line => lines.push(line) });
  assert.match(lines[0], /--apply/);
});
