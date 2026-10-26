import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { createGameApi } from './api.js';
import { loadLocalEnvironment } from './bot/config.js';
import { productionOptionsFromEnv } from './production-config.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.ico':'image/x-icon' };

export function createProductionServer(options) {
  const api = createGameApi(options), assets = resolve(root, 'dist');
  const server = createServer((request, response) => {
    api.handle(request, response, async () => {
      try {
        if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const file = resolve(assets, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!file.startsWith(`${assets}${sep}`) || pathname.includes('\0')) throw new Error('Invalid file');
        const info = await stat(file);
        if (!info.isFile()) throw new Error('Missing file');
        response.writeHead(200, { 'Content-Type':MIME[extname(file)] ?? 'application/octet-stream', 'Content-Length':info.size,
          'X-Content-Type-Options':'nosniff', 'Cache-Control':file.includes(`${sep}assets${sep}`) ? 'public, max-age=3600' : 'no-cache' });
        if (request.method === 'HEAD') response.end();
        else createReadStream(file).on('error', () => response.destroy()).pipe(response);
      } catch { response.writeHead(404); response.end('Not found'); }
    });
  });
  server.on('close', () => api.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  loadLocalEnvironment(root);
  const { host, port, ...options } = productionOptionsFromEnv();
  // The Python bot retains its Gateway connection and handles /play. This
  // service only hosts the Activity, OAuth exchange and durable game data.
  const server = createProductionServer(options);
  server.listen(port, host, () => { console.log(`Forest Trail listening on ${host}:${port}`); });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close());
}
