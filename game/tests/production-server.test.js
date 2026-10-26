import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionServer } from '../server/main.js';

test('standalone hosting serves the built game and API without exposing server files or credentials', async () => {
  const server = createProductionServer({ databasePath:':memory:', clientId:'1556624227212460092' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200); assert.match(await page.text(), /Forest Trail/);
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.configured, false);
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status:'ok', botConfigured:false });
    assert.equal((await fetch(`${base}/api/discord/interactions`, { method:'POST', body:'{}' })).status, 503);
    for (const path of ['/.env.server.local','/server/api.js','/.data/leaderboard.sqlite','/%2e%2e%2f.env.server.local'])
      assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
