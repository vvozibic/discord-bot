import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLocalEndpointPlan, loadLocalBotRuntime, main, refreshLocalDiscordEndpoint } from '../scripts/refresh-local-discord-endpoint.js';

const applicationId = '123456789012345678';
const env = { DISCORD_CLIENT_ID:applicationId, DISCORD_PUBLIC_KEY:'ab'.repeat(32), DISCORD_BOT_TOKEN:'private-endpoint-test-token' };
const root = resolve('tests', 'endpoint-fixture');
const runtime = { schemaVersion:1, projectRoot:root, publicUrl:'https://forest-trail-fixture.trycloudflare.com' };
const endpointUrl = `${runtime.publicUrl}/api/discord/interactions`;
const response = body => ({ ok:true, status:200, json:async () => body });

test('apply verifies current application identity and PATCHes only the changed endpoint field', async () => {
  const calls = [];
  const result = await refreshLocalDiscordEndpoint({ env, runtime, root, apply:true, fetchImpl:async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(url, 'https://discord.com/api/v10/applications/@me');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, `Bot ${env.DISCORD_BOT_TOKEN}`);
    return response({ id:applicationId, interactions_endpoint_url:options.method === 'GET' ? 'https://old.example/interactions' : endpointUrl, private:env.DISCORD_BOT_TOKEN });
  } });
  assert.equal(result.status, 'updated');
  assert.equal(result.endpointUrl, endpointUrl);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'PATCH']);
  assert.equal(calls[0].body, undefined);
  assert.deepEqual(JSON.parse(calls[1].body), { interactions_endpoint_url:endpointUrl });
  assert.ok(!JSON.stringify(result).includes(env.DISCORD_BOT_TOKEN));
});

test('an unchanged endpoint needs one identity GET and no PATCH', async () => {
  const methods = [];
  const result = await refreshLocalDiscordEndpoint({ env, runtime, root, apply:true, fetchImpl:async (url, options) => {
    methods.push(options.method);
    return response({ id:applicationId, interactions_endpoint_url:endpointUrl });
  } });
  assert.equal(result.status, 'unchanged');
  assert.deepEqual(methods, ['GET']);
});

test('wrong application identity prevents endpoint mutation', async () => {
  const methods = [];
  await assert.rejects(refreshLocalDiscordEndpoint({ env, runtime, root, apply:true, fetchImpl:async (url, options) => {
    methods.push(options.method);
    return response({ id:'234567890123456789' });
  } }), /different application.*No endpoint was changed/);
  assert.deepEqual(methods, ['GET']);
});

test('unsafe tunnel URLs and unrelated or unsupported runtime files fail before network', async () => {
  const invalidUrls = ['http://forest.trycloudflare.com', 'https://trycloudflare.com', 'https://forest.trycloudflare.com.evil.example',
    'https://user:private@forest.trycloudflare.com', 'https://forest.trycloudflare.com:8443', 'https://forest.trycloudflare.com/path',
    'https://forest.trycloudflare.com?token=private', 'https://forest.trycloudflare.com#private', 'https://forest.trycloudflare.com?',
    'https://forest.trycloudflare.com#', 'https://.trycloudflare.com', 'https://for\nest.trycloudflare.com', ' https://forest.trycloudflare.com', null, 123];
  for (const publicUrl of invalidUrls) {
    await assert.rejects(refreshLocalDiscordEndpoint({ env, root, runtime:{ ...runtime, publicUrl }, apply:true,
      fetchImpl:async () => assert.fail('unsafe URL must not contact Discord') }), /runtime requires/);
  }
  for (const invalidRuntime of [{ ...runtime, schemaVersion:2 }, { ...runtime, projectRoot:resolve(root, '..') }, {}, null]) {
    await assert.rejects(refreshLocalDiscordEndpoint({ env, root, runtime:invalidRuntime, apply:true,
      fetchImpl:async () => assert.fail('invalid runtime must not contact Discord') }), /schemaVersion 1/);
  }
  assert.equal(createLocalEndpointPlan({ env, root, runtime:{ ...runtime, publicUrl:`${runtime.publicUrl}/` } }).endpointUrl, endpointUrl);
});

test('missing application ID, public key, or bot token prevents every request', async () => {
  for (const [key, value] of [['DISCORD_CLIENT_ID', ''], ['DISCORD_PUBLIC_KEY', ''], ['DISCORD_PUBLIC_KEY', 'bad'], ['DISCORD_BOT_TOKEN', '']]) {
    await assert.rejects(refreshLocalDiscordEndpoint({ env:{ ...env, [key]:value }, root, runtime, apply:true,
      fetchImpl:async () => assert.fail('missing configuration must not contact Discord') }), new RegExp(key));
  }
});

test('API, transport, and JSON failures never expose credentials or response bodies', async () => {
  for (const fetchImpl of [
    async () => ({ ok:false, status:401, json:async () => assert.fail('error body must not be read'), text:async () => assert.fail('error body must not be read') }),
    async () => { throw new Error(`private transport ${env.DISCORD_BOT_TOKEN}`); },
    async () => ({ ok:true, json:async () => { throw new Error(`private JSON ${env.DISCORD_BOT_TOKEN}`); } }),
  ]) {
    await assert.rejects(refreshLocalDiscordEndpoint({ env, root, runtime, apply:true, fetchImpl }), error => {
      assert.ok(!error.message.includes(env.DISCORD_BOT_TOKEN));
      assert.ok(!error.message.includes('private'));
      return true;
    });
  }
});

test('a successful HTTP PATCH must confirm the expected application and endpoint', async () => {
  let requests = 0;
  await assert.rejects(refreshLocalDiscordEndpoint({ env, root, runtime, apply:true, fetchImpl:async () => {
    requests += 1;
    return response({ id:applicationId, interactions_endpoint_url:'https://unexpected.example/' });
  } }), /did not confirm/);
  assert.equal(requests, 2);
});

test('CLI defaults to a dry run with no requests or credential output', async () => {
  const lines = [];
  const result = await main({ argv:[], env, runtime, root, output:line => lines.push(line), fetchImpl:async () => assert.fail('dry run must not contact Discord') });
  assert.equal(result.status, 'dry-run');
  assert.match(lines.join('\n'), /Dry run/);
  assert.ok(lines.join('\n').includes(endpointUrl));
  assert.ok(!lines.join('\n').includes(env.DISCORD_BOT_TOKEN));
  assert.ok(!lines.join('\n').includes(env.DISCORD_PUBLIC_KEY));
  assert.equal((await refreshLocalDiscordEndpoint({ env:{ DISCORD_CLIENT_ID:applicationId }, root, runtime })).status, 'dry-run');
});

test('runtime loader and CLI report local file errors without exposing file contents', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'forest-endpoint-'));
  try {
    await assert.rejects(loadLocalBotRuntime({ root:temporaryRoot }), /Start the local bot launcher first/);
    await writeFile(join(temporaryRoot, '.local-bot-runtime.json'), `invalid ${env.DISCORD_BOT_TOKEN}`);
    await assert.rejects(loadLocalBotRuntime({ root:temporaryRoot }), error => !error.message.includes(env.DISCORD_BOT_TOKEN));
    const localRuntime = { ...runtime, projectRoot:temporaryRoot };
    await writeFile(join(temporaryRoot, '.local-bot-runtime.json'), JSON.stringify(localRuntime));
    await writeFile(join(temporaryRoot, '.env.server.local'), `DISCORD_CLIENT_ID=${applicationId}\n`);
    const result = await main({ argv:[], root:temporaryRoot, output:() => {}, fetchImpl:async () => assert.fail('dry run must not contact Discord') });
    assert.equal(result.status, 'dry-run');
  } finally { await rm(temporaryRoot, { recursive:true, force:true }); }
});

test('help needs no files and unknown flags fail before network', async () => {
  const lines = [];
  await main({ argv:['--help'], output:line => lines.push(line) });
  assert.match(lines[0], /--apply/);
  await assert.rejects(main({ argv:['--force'], fetchImpl:async () => assert.fail('invalid option must not contact Discord') }), /Unknown option/);
});
