import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordRest } from '../server/bot/rest.js';

test('Discord credentials go only to fixed-origin REST requests; interaction webhooks use their own token', async () => {
  const requests = [];
  const rest = createDiscordRest({ token:'private-bot-token', fetchImpl:async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ id:'123456789012345678' }), { status:200 });
  } });
  await rest.request('POST', '/channels/123456789012345678/messages', { content:'test' });
  await rest.request('PATCH', '/webhooks/123456789012345678/interaction-token/messages/@original', { content:'done' }, { webhook:true });
  assert.equal(requests[0].options.headers.Authorization, 'Bot private-bot-token');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[1].options.headers.Authorization, undefined);
  assert.ok(requests.every(item => item.url.startsWith('https://discord.com/api/v10/')));
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  for (const path of ['https://example.com', '//example.com', '/../users']) {
    await assert.rejects(rest.request('GET', path), /Invalid Discord API path/);
  }
});

test('REST failure does not disclose Discord response bodies or credentials', async () => {
  const rest = createDiscordRest({ token:'private-bot-token', fetchImpl:async () => new Response('secret interaction detail', { status:403 }) });
  await assert.rejects(rest.request('POST', '/channels/123/messages', {}), error => {
    assert.equal(error.status, 403);
    assert.doesNotMatch(error.message, /secret|private-bot-token/);
    return true;
  });
  await assert.rejects(createDiscordRest().request('POST', '/channels/123/messages', {}), /DISCORD_BOT_TOKEN/);
});

test('REST sends multipart attachments intact and lets fetch set the content boundary', async () => {
  const calls = [];
  const rest = createDiscordRest({ token:'private-bot-token', fetchImpl:async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id:'123456789012345678' }), { status:200 });
  } });
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ embeds:[{ image:{ url:'attachment://logo.png' } }] }));
  form.append('files[0]', new Blob([new Uint8Array([137,80,78,71])], { type:'image/png' }), 'logo.png');
  await rest.request('PATCH', '/channels/123456789012345678/messages/123456789012345678', form);
  assert.equal(calls[0].options.body, form);
  assert.equal(calls[0].options.headers['Content-Type'], undefined);
  assert.equal(calls[0].options.headers.Authorization, 'Bot private-bot-token');
  assert.equal(calls[0].options.redirect, 'error');
});
