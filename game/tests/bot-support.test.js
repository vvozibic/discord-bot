import test from 'node:test';
import assert from 'node:assert/strict';
import { SupportValidationError, supportEmbed, postSupportCard, updateSupportCard, setTicketPanelSuppressed } from '../server/bot/support.js';

const GUILD = '333333333333333333';
const CHANNEL = '444444444444444444';
const MESSAGE = '555555555555555555';
const CLIENT = '666666666666666666';
const TICKET_TOOL = '777777777777777777';
const WEBHOOK = '888888888888888888';
const OTHER = '999999999999999999';
const CONTENT = { title:'Mindo support', description:'Choose Create ticket below to contact the team.' };
const BASE = { guildId:GUILD, channelId:CHANNEL };
const TARGET = { ...BASE, ticketMessageId:MESSAGE, ticketToolApplicationId:TICKET_TOOL };
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6e2sAAAAASUVORK5CYII=', 'base64'));
const IMAGE_CONTENT = { ...CONTENT, imageAttachment:{ filename:'pulse-logo.png', contentType:'image/png', data:PNG } };

function fakeRest({ channel = {}, message = {}, failure } = {}) {
  const calls = [];
  const rest = { async request(method, path, body) {
    calls.push({ method, path, body });
    if (failure?.method === method) throw new Error('Discord request failed');
    if (method === 'GET' && path === `/channels/${CHANNEL}`) return { id:CHANNEL, guild_id:GUILD, type:0, ...channel };
    if (method === 'GET' && path === `/channels/${CHANNEL}/messages/${MESSAGE}`) {
      return { id:MESSAGE, channel_id:CHANNEL, author:{ id:TICKET_TOOL, bot:true }, flags:0, ...message };
    }
    if (method === 'POST') return { id:MESSAGE, channel_id:CHANNEL };
    if (method === 'PATCH') return { id:MESSAGE, channel_id:CHANNEL, ...body };
    throw new Error(`Unexpected request: ${method} ${path}`);
  } };
  return { rest, calls };
}

test('support embed validates copy, limits and HTTPS image without accepting extra payload fields', () => {
  assert.deepEqual(supportEmbed({ description:' Contact us ', content:'@everyone', components:[{}] }), {
    title:'Support', description:'Contact us', color:0x00ff99,
  });
  const embed = supportEmbed({ ...CONTENT, imageUrl:'https://images.example.test/support.png' });
  assert.equal(embed.image.url, 'https://images.example.test/support.png');
  assert.equal(embed.description, CONTENT.description);
  for (const content of [null, [], {}, { description:' ' }, { description:1 }, { description:'x'.repeat(4097) },
    { description:'hello', title:'x'.repeat(257) }, { description:'bad\0copy' }, { description:'hello', title:'' }]) {
    assert.throws(() => supportEmbed(content));
  }
  for (const imageUrl of ['http://example.test/image.png', 'javascript:alert(1)', 'file:///photo.png', 'not a URL',
    'https://user:password@example.test/image.png', {}, 'https://example.test/' + 'a'.repeat(2048)]) {
    assert.throws(() => supportEmbed({ ...CONTENT, imageUrl }), /HTTPS/);
  }
});

test('posting verifies the guild text channel and sends only a mention-disabled custom card', async () => {
  const { rest, calls } = fakeRest();
  assert.deepEqual(await postSupportCard({ rest, ...BASE, content:CONTENT }), { ...BASE, wrapperMessageId:MESSAGE });
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [
    ['GET', `/channels/${CHANNEL}`], ['POST', `/channels/${CHANNEL}/messages`],
  ]);
  assert.deepEqual(calls[1].body, { embeds:[supportEmbed(CONTENT)], allowed_mentions:{ parse:[], users:[], roles:[], replied_user:false } });
  assert.equal(calls[1].body.components, undefined);
});

test('invalid content or IDs fail before any REST call', async () => {
  for (const extra of [{ content:{} }, { guildId:'not-an-id' }, { channelId:`${CHANNEL}/messages` }]) {
    const { rest, calls } = fakeRest();
    await assert.rejects(postSupportCard({ rest, ...BASE, content:CONTENT, ...extra }));
    assert.equal(calls.length, 0);
  }
});

test('posting, updating and suppression reject channels outside the configured guild or text channel type', async () => {
  for (const channel of [{ guild_id:OTHER }, { type:1 }, { type:5 }, { type:11 }, { id:OTHER }]) {
    for (const operation of [
      rest => postSupportCard({ rest, ...BASE, content:CONTENT }),
      rest => updateSupportCard({ rest, ...BASE, wrapperMessageId:MESSAGE, clientId:CLIENT, content:CONTENT }),
      rest => setTicketPanelSuppressed({ rest, ...TARGET }),
    ]) {
      const { rest, calls } = fakeRest({ channel });
      await assert.rejects(operation(rest), /text channel/);
      assert.equal(calls.length, 1);
    }
  }
});

test('updates our card in place and does not publish another card or touch buttons', async () => {
  const { rest, calls } = fakeRest({ message:{ author:{ id:CLIENT, bot:true } } });
  const result = await updateSupportCard({ rest, ...BASE, wrapperMessageId:MESSAGE, clientId:CLIENT, content:CONTENT });
  assert.deepEqual(result, { ...BASE, wrapperMessageId:MESSAGE });
  assert.equal(calls.some(call => call.method === 'POST'), false);
  assert.deepEqual(Object.keys(calls.at(-1).body).sort(), ['allowed_mentions','attachments','embeds']);
  assert.deepEqual(calls.at(-1).body.attachments, []);
});

test('updates refuse another author, webhook, or a mismatched returned message', async () => {
  for (const message of [{ author:{ id:OTHER, bot:true } }, { author:{ id:CLIENT }, webhook_id:WEBHOOK },
    { id:OTHER, author:{ id:CLIENT } }, { channel_id:OTHER, author:{ id:CLIENT } }]) {
    const { rest, calls } = fakeRest({ message });
    await assert.rejects(updateSupportCard({ rest, ...BASE, wrapperMessageId:MESSAGE, clientId:CLIENT, content:CONTENT }));
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
  }
});

test('suppression preserves all flags and changes only flags on authentic Ticket Tool message', async () => {
  const previous = 2 ** 40 + 4096;
  const components = [{ type:1, components:[{ type:2, style:1, custom_id:'ticket-tool-create-ticket' }] }];
  const { rest, calls } = fakeRest({ message:{ flags:previous, components, embeds:[{ title:'Support' }], content:'Existing content' } });
  const result = await setTicketPanelSuppressed({ rest, ...TARGET });
  assert.equal(result.flags, previous + 4);
  assert.equal(result.suppressed, true);
  assert.deepEqual(calls.at(-1), { method:'PATCH', path:`/channels/${CHANNEL}/messages/${MESSAGE}`, body:{ flags:previous + 4 } });
  assert.equal(components[0].components[0].custom_id, 'ticket-tool-create-ticket');
});

test('restoring removes only SUPPRESS_EMBEDS and leaves the original button untouched', async () => {
  const { rest, calls } = fakeRest({ message:{ flags:4100 } });
  const result = await setTicketPanelSuppressed({ rest, ...TARGET, suppressed:false });
  assert.equal(result.flags, 4096);
  assert.deepEqual(calls.at(-1).body, { flags:4096 });
});

test('metadata-only target with hidden components works without Message Content Intent', async () => {
  const { rest, calls } = fakeRest({ message:{ components:[], embeds:[], content:'' } });
  await setTicketPanelSuppressed({ rest, ...TARGET });
  assert.deepEqual(calls.at(-1).body, { flags:4 });
});

test('already suppressed or restored panels are idempotent and cause no mutation', async () => {
  for (const [flags, suppressed] of [[4,true], [4100,true], [0,false], [4096,false]]) {
    const { rest, calls } = fakeRest({ message:{ flags } });
    const result = await setTicketPanelSuppressed({ rest, ...TARGET, suppressed });
    assert.equal(result.flags, flags);
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
  }
});

test('only the configured application may own a webhook panel', async () => {
  const { rest, calls } = fakeRest({ message:{ webhook_id:WEBHOOK, author:{ id:WEBHOOK, bot:true }, application_id:TICKET_TOOL } });
  await setTicketPanelSuppressed({ rest, ...TARGET });
  assert.deepEqual(calls.at(-1).body, { flags:4 });
});

test('spoofed bot names, unowned webhooks and inconsistent application IDs cannot be suppressed', async () => {
  for (const message of [{ author:{ id:OTHER, bot:true, username:'Ticket Tool' } }, { author:{ id:TICKET_TOOL } },
    { webhook_id:WEBHOOK, author:{ id:TICKET_TOOL, bot:true } }, { application_id:OTHER },
    { webhook_id:WEBHOOK, application_id:OTHER }, { id:OTHER }, { channel_id:OTHER }]) {
    const { rest, calls } = fakeRest({ message });
    await assert.rejects(setTicketPanelSuppressed({ rest, ...TARGET }));
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
  }
});

test('suppression requires explicit valid app/message IDs and a boolean action before contacting Discord', async () => {
  for (const extra of [{ ticketToolApplicationId:undefined }, { ticketToolApplicationId:'Ticket Tool' },
    { ticketMessageId:undefined }, { ticketMessageId:'all' }, { suppressed:'false' }]) {
    const { rest, calls } = fakeRest();
    await assert.rejects(setTicketPanelSuppressed({ rest, ...TARGET, ...extra }));
    assert.equal(calls.length, 0);
  }
});

test('invalid Discord flags fail safely before patching the message', async () => {
  for (const flags of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '4']) {
    const { rest, calls } = fakeRest({ message:{ flags } });
    await assert.rejects(setTicketPanelSuppressed({ rest, ...TARGET }), /invalid message flags/);
    assert.equal(calls.some(call => call.method === 'PATCH'), false);
  }
});

test('Discord permission/network failures propagate without alternate posts or changed targets', async () => {
  const { rest, calls } = fakeRest({ failure:{ method:'PATCH' } });
  await assert.rejects(setTicketPanelSuppressed({ rest, ...TARGET }), /Discord request failed/);
  assert.deepEqual(calls.map(call => call.method), ['GET','GET','PATCH']);
  assert.equal(calls.at(-1).path, `/channels/${CHANNEL}/messages/${MESSAGE}`);
});

test('only explicit support validation failures get the safe validation error type', async () => {
  assert.throws(() => supportEmbed({ description:'' }), error => {
    assert.ok(error instanceof SupportValidationError);
    assert.equal(error.name, 'SupportValidationError');
    assert.match(error.message, /Support description/);
    return true;
  });
  const { rest } = fakeRest({ message:{ author:{ id:OTHER, bot:true } } });
  await assert.rejects(setTicketPanelSuppressed({ rest, ...TARGET }), SupportValidationError);
  const networkError = new Error('private network diagnostics');
  const failingRest = { request:async () => { throw networkError; } };
  await assert.rejects(postSupportCard({ rest:failingRest, ...BASE, content:CONTENT }), error => {
    assert.equal(error, networkError);
    assert.equal(error instanceof SupportValidationError, false);
    return true;
  });
});

test('support uploads embed their image from a Discord attachment without external fetches', async () => {
  const { rest, calls } = fakeRest();
  await postSupportCard({ rest, ...BASE, content:IMAGE_CONTENT });
  assert.deepEqual(supportEmbed(IMAGE_CONTENT).image, { url:'attachment://pulse-logo.png' });
  const form = calls.at(-1).body;
  assert.ok(form instanceof FormData);
  const payload = JSON.parse(form.get('payload_json'));
  assert.deepEqual(payload.attachments, [{ id:0, filename:'pulse-logo.png' }]);
  assert.deepEqual(payload.allowed_mentions, { parse:[], users:[], roles:[], replied_user:false });
  assert.equal(payload.embeds[0].image.url, 'attachment://pulse-logo.png');
  const file = form.get('files[0]');
  assert.equal(file.name, 'pulse-logo.png');
  assert.equal(file.type, 'image/png');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PNG);
});

test('image attachment edits replace old files and preserve own-author validation', async () => {
  const { rest, calls } = fakeRest({ message:{ author:{ id:CLIENT, bot:true }, attachments:[{ id:OTHER, filename:'old.png' }] } });
  await updateSupportCard({ rest, ...BASE, wrapperMessageId:MESSAGE, clientId:CLIENT, content:IMAGE_CONTENT });
  const payload = JSON.parse(calls.at(-1).body.get('payload_json'));
  assert.deepEqual(payload.attachments, [{ id:0, filename:'pulse-logo.png' }]);
  assert.equal(payload.components, undefined);
  const foreign = fakeRest();
  await assert.rejects(updateSupportCard({ rest:foreign.rest, ...BASE, wrapperMessageId:MESSAGE, clientId:CLIENT, content:IMAGE_CONTENT }), /own support cards/);
  assert.equal(foreign.calls.some(call => call.method === 'PATCH'), false);
});

test('URL-only or text-only edits explicitly remove old uploaded attachments', async () => {
  for (const content of [CONTENT, { ...CONTENT, imageUrl:'https://images.example.test/new.png' }]) {
    const { rest, calls } = fakeRest({ message:{ author:{ id:CLIENT, bot:true }, attachments:[{ id:OTHER }] } });
    await updateSupportCard({ rest, ...BASE, wrapperMessageId:MESSAGE, clientId:CLIENT, content });
    assert.deepEqual(calls.at(-1).body.attachments, []);
    assert.deepEqual(calls.at(-1).body.embeds[0].image, content.imageUrl ? { url:content.imageUrl } : undefined);
  }
});

test('invalid or conflicting uploads fail before sending any Discord request', async () => {
  for (const imageAttachment of [{ filename:'../private.png', data:PNG }, { filename:'logo.svg', data:PNG },
    { filename:'logo.png', data:'base64' }, { filename:'logo.png', data:new Uint8Array(0) },
    { filename:'logo.png', data:new Uint8Array(20 * 1024 * 1024 + 1) },
    { filename:'logo.png', contentType:'image/jpeg', data:PNG }, { filename:'logo.jpeg', data:PNG }]) {
    const { rest, calls } = fakeRest();
    await assert.rejects(postSupportCard({ rest, ...BASE, content:{ ...CONTENT, imageAttachment } }), SupportValidationError);
    assert.equal(calls.length, 0);
  }
  assert.throws(() => supportEmbed({ ...IMAGE_CONTENT, imageUrl:'https://example.test/logo.png' }), /either/);
});
