// Local-only component fixture. Never imported by the application or production server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameApi } from '../server/api.js';
import { recordedVictory } from './fixtures/ranked-run.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
let clock = Date.now();
const api = createGameApi({ clientId:'1556624227212460092', now:() => clock,
  authenticate:async ({ code }) => ({ accessToken:'qa-not-a-discord-token', expiresIn:3600,
    profile:{ id:code === 'alice' ? '123456789012345678' : '223456789012345678', name:code === 'alice' ? 'Alice · QA account' : '<Bob> · QA account',
      avatar:'https://cdn.discordapp.com/embed/avatars/0.png' } }) });
const server = createServer(async (request, response) => {
  if (request.url === '/qa/advance' && request.method === 'POST') { clock += 120000; response.end('{}'); return; }
  api.handle(request, response, async () => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/') {
        const html = (await readFile(resolve(root, 'index.html'), 'utf8')).replace('</head>', '<link rel="stylesheet" href="/src/adventure.css" /></head>')
          .replace('/src/adventure.js', '/tests/fixtures/profile-ui.js');
        response.setHeader('Content-Type','text/html'); response.end(html); return;
      }
      const relative = path === '/assets/pulse-logo.png' ? 'public/assets/pulse-logo.png' : path.slice(1);
      const file = resolve(root, relative);
      if (!file.startsWith(root + sep) || !/^(src\/|tests\/fixtures\/|public\/assets\/)/.test(relative)) throw new Error('Not allowed');
      response.setHeader('Content-Type', { '.js':'text/javascript', '.css':'text/css', '.png':'image/png' }[extname(file)] || 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
});
await new Promise(resolve => server.listen(5182, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:5182';
async function post(path, body, token) {
  const result = await fetch(`${base}/api${path}`, { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) }, body:JSON.stringify(body) });
  if (!result.ok) throw new Error('Fixture setup failed');
  return result.json();
}
for (const code of ['alice','bob']) {
  const session = await post('/discord/session', { code, guildId:'333333333333333333' });
  const plan = await post('/runs', {}, session.token), recording = recordedVictory(plan.config);
  clock += (recording.seconds + 1) * 1000;
  await post('/runs/finish', { ticket:plan.ticket, trace:recording.trace }, session.token);
}
console.log('Profile UI fixture ready on http://127.0.0.1:5182 (QA accounts only)');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => { api.close(); process.exit(); }));
