import test from 'node:test';
import assert from 'node:assert/strict';
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
