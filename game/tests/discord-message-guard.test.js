import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundedDiscordPayload, protectDiscordMessages } from '../src/discord-message-guard.js';

test('normal SDK ready, authorization and profile messages fit within the payload budget', () => {
  assert.equal(boundedDiscordPayload([3, { v:1, config:{ api_endpoint:'//discord.com/api' } }]), true);
  assert.equal(boundedDiscordPayload([1, { cmd:'AUTHORIZE', nonce:'id', data:{ code:'fixture-code' } }]), true);
  assert.equal(boundedDiscordPayload([1, { cmd:'AUTHENTICATE', data:{ user:{ id:'123456789012345678', username:'Player' }, scopes:['identify','guilds.members.read'] } }]), true);
});

test('oversized collections, long strings, excessive nesting and aggregate work are rejected before parsing', () => {
  assert.equal(boundedDiscordPayload(new Array(1025).fill(null)), false);
  assert.equal(boundedDiscordPayload('x'.repeat(65537)), false);
  assert.equal(boundedDiscordPayload(new Array(6).fill('x'.repeat(60000))), false);
  assert.equal(boundedDiscordPayload(Array.from({ length:10 }, () => new Array(512).fill(null))), false);
  let nested = null;
  for (let i = 0; i < 26; i++) nested = { nested };
  assert.equal(boundedDiscordPayload(nested), false);
  assert.equal(boundedDiscordPayload(new Map()), false);
});

test('only bounded messages from the actual Discord parent reach SDK validation', () => {
  const source = {}, otherWindow = {};
  let guard, removed = false;
  const target = {
    addEventListener(name, listener, capture) { assert.equal(name, 'message'); assert.equal(capture, true); guard = listener; },
    removeEventListener(name, listener, capture) { removed = name === 'message' && listener === guard && capture; },
  };
  const cleanup = protectDiscordMessages(target, source);
  for (const [origin, sender, data, blocked] of [
    ['https://discord.com', source, [3, {}], false],
    ['https://discord.com', otherWindow, [3, {}], true],
    ['https://example.com', source, [3, {}], true],
    ['https://discord.com', source, new Array(1025), true],
  ]) {
    let stopped = false;
    guard({ origin, source:sender, data, stopImmediatePropagation() { stopped = true; } });
    assert.equal(stopped, blocked);
  }
  cleanup(); assert.equal(removed, true);
});

test('native shell RPC reaches the SDK from the exact Activity origin', () => {
  const origin = 'https://1466831420575186985.discordsays.com', source = {};
  let guard;
  const target = { location:{ origin }, addEventListener(name, listener) { guard = listener; } };
  protectDiscordMessages(target, source);
  for (const data of [
    [1, { evt:'READY', cmd:'DISPATCH', data:{ v:1, config:{ api_endpoint:'//discord.com/api' } } }],
    [1, { cmd:'AUTHORIZE', nonce:'authorize', data:{ code:'fixture-code' } }],
    [1, { cmd:'AUTHENTICATE', nonce:'authenticate', data:{ user:{ id:'123456789012345678', username:'Player' }, scopes:['identify'] } }],
  ]) {
    let stopped = false;
    guard({ origin, source, data, stopImmediatePropagation() { stopped = true; } });
    assert.equal(stopped, false);
  }
});

test('Activity-origin RPC retains exact sender, origin and payload protections', () => {
  const origin = 'https://1466831420575186985.discordsays.com', source = {}, otherWindow = {};
  let guard;
  const target = { location:{ origin }, addEventListener(name, listener) { guard = listener; } };
  protectDiscordMessages(target, source);
  for (const [senderOrigin, sender, data] of [
    [origin, otherWindow, [1, { evt:'READY' }]],
    ['https://1556624227212460092.discordsays.com', source, [1, { evt:'READY' }]],
    ['https://1466831420575186985.discordsays.com.example.com', source, [1, { evt:'READY' }]],
    ['https://shell.1466831420575186985.discordsays.com', source, [1, { evt:'READY' }]],
    ['http://1466831420575186985.discordsays.com', source, [1, { evt:'READY' }]],
    [`${origin}:444`, source, [1, { evt:'READY' }]],
    [origin, source, new Array(1025)],
  ]) {
    let stopped = false;
    guard({ origin:senderOrigin, source:sender, data, stopImmediatePropagation() { stopped = true; } });
    assert.equal(stopped, true, `${senderOrigin} must retain RPC validation`);
  }
});

test('a missing or invalid document origin never adds an allowed origin', () => {
  const source = {};
  for (const origin of [undefined, '', 'invalid-origin']) {
    let guard;
    const target = { location:{ origin }, addEventListener(name, listener) { guard = listener; } };
    protectDiscordMessages(target, source);
    let stopped = false;
    guard({ origin, source, data:[3, {}], stopImmediatePropagation() { stopped = true; } });
    assert.equal(stopped, true);
  }
});

test('the installed Discord SDK completes READY through the native shell forwarding shim', () => {
  // Keep the SDK's browser globals and module-level origin cache isolated.
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd:fileURLToPath(new URL('..', import.meta.url)), encoding:'utf8', timeout:10000,
    input:String.raw`
      import assert from 'node:assert/strict';
      const origin = 'https://1466831420575186985.discordsays.com';
      const shellOrigin = 'https://shell.1466831420575186985.discordsays.com';
      function message(data, origin, source) {
        const event = new Event('message');
        Object.defineProperties(event, { data:{ value:data }, origin:{ value:origin }, source:{ value:source } });
        return event;
      }
      const target = new EventTarget(), handshakes = [];
      const parent = { opener:null, postMessage(payload, targetOrigin) {
        handshakes.push({ payload, targetOrigin });
        queueMicrotask(() => target.dispatchEvent(message([1, {
          cmd:'DISPATCH', evt:'READY', nonce:null,
          data:{ v:1, config:{ api_endpoint:'//discord.com/api', environment:'production' } },
        }], shellOrigin, parent)));
      } };
      target.parent = parent;
      target.location = { origin, search:'?frame_id=fixture-frame&instance_id=fixture-instance&platform=desktop&discord_shim=1' };
      globalThis.window = target;
      globalThis.document = { referrer:shellOrigin + '/' };
      // Discord's proxy installs this capture listener before application code.
      target.addEventListener('message', event => {
        if (event.origin !== shellOrigin || event.source !== parent) return;
        event.stopImmediatePropagation();
        target.dispatchEvent(message(event.data, origin, parent));
      }, true);
      const { protectDiscordMessages } = await import('./src/discord-message-guard.js');
      const { DiscordSDK } = await import('@discord/embedded-app-sdk');
      protectDiscordMessages(target, parent);
      const sdk = new DiscordSDK('1466831420575186985', { disableConsoleLogOverride:true });
      let ready = false;
      sdk.ready().then(() => { ready = true; });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(handshakes.length, 1);
      assert.equal(handshakes[0].payload[0], 0);
      assert.equal(handshakes[0].targetOrigin, shellOrigin + '/');
      assert.equal(ready, true, 'the forwarded READY must reach the SDK instead of leaving startup pending');
    `,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
