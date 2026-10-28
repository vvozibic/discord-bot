import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { createSqliteGameStore } from './game-store.js';
import { createDiscordAuth } from './discord-auth.js';
import { createLevelDirector, PROGRESS_KEY } from '../src/level-director.js';
import { replayRun } from './replay.js';
import { createDiscordBot } from './bot/interactions.js';
import { normalizeRewards, equipRewards, grantRewards } from '../src/rewards.js';

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const LIMIT = 1024 * 1024;
async function jsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'JSON is required');
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > LIMIT) throw new ApiError(413, 'Request is too large');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    return body;
  }
  catch { throw new ApiError(400, 'Invalid JSON'); }
}

export function createGameApi({ databasePath = ':memory:', clientId = '', clientSecret = '', eventId = 'tag',
  eventName = 'TAG campaign', botApiKey = '', allowedGuildId = '', allowedRoleIds = [], authenticate, now = Date.now, bot = {}, healthStatus = {}, gameStore, databaseUrl } = {}) {
  if (databaseUrl && !gameStore) throw new Error('Open the PostgreSQL game store before creating the game API.');
  const store = gameStore ?? createSqliteGameStore(databasePath, { eventId, now });
  const sessions = new Map(), limits = new Map();
  const discordBot = store.botStore ? createDiscordBot({ ...bot, store:store.botStore, clientId, eventId, eventName, now,
    readRanking:(guildId, userId) => store.ranking(`guild:${guildId}:event:${eventId}`, userId) }) : {
    configured:false, pendingCount:0, whenIdle:async () => {},
    handle:async (_request, response) => send(response, 503, { error:'The existing Python bot handles Discord interactions.' }),
  };
  const configured = Boolean(clientId && (clientSecret || authenticate));
  const verifyDiscord = authenticate ?? createDiscordAuth({ clientId, clientSecret, allowedGuildId, allowedRoleIds });
  function rate(key, maximum) {
    const time = now();
    if (limits.size > 4000) for (const [id, item] of limits) if (item.until < time) limits.delete(id);
    let bucket = limits.get(key);
    if (!bucket || bucket.until < time) limits.set(key, bucket = { until:time + 60000, count:0 });
    if (++bucket.count > maximum) throw new ApiError(429, 'Please wait a moment before trying again');
  }
  function getSession(request) {
    const token = request.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1];
    const session = sessions.get(token);
    if (!session || session.expires <= now()) { sessions.delete(token); throw new ApiError(401, 'Reconnect your Discord profile to continue'); }
    return { ...session, token };
  }
  function directorFor(profile) {
    if (!profile) throw new ApiError(401, 'Reconnect your Discord profile to continue');
    let progress = profile.progress, dirty = false;
    const director = createLevelDirector({ storage:{
      getItem:key => key === PROGRESS_KEY ? progress : null,
      setItem:(key, value) => { if (key === PROGRESS_KEY) { progress = value; dirty = true; } },
    } });
    return { director, flush:async tx => { if (dirty) await tx.saveProgress(progress); } };
  }
  function send(response, status, data) {
    response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
    response.end(JSON.stringify(data));
  }
  async function handle(request, response, next) {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/healthz' && request.method === 'GET') {
      let health;
      try { health = typeof healthStatus === 'function' ? await healthStatus() : healthStatus; }
      catch { health = { status:'database_unavailable', gameConfigured:false }; }
      send(response, 200, { status:'ok', botConfigured:discordBot.configured, ...health }); return;
    }
    if (pathname === '/api/discord/interactions') { await discordBot.handle(request, response); return; }
    if (!pathname.startsWith('/api/')) { next?.(); return; }
    try {
      const origin = request.headers.origin;
      if (origin && origin !== `https://${clientId}.discordsays.com` && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`)
        throw new ApiError(403, 'This origin is not allowed');
      if (pathname === '/api/config' && request.method === 'GET') {
        send(response, 200, { configured, clientId, eventName }); return;
      }
      if (pathname === '/api/bot/leaderboard' && request.method === 'GET' && botApiKey.length >= 32) {
        const provided = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
        if (!timingSafeEqual(createHash('sha256').update(provided).digest(), createHash('sha256').update(botApiKey).digest())) throw new ApiError(401, 'Invalid service credential');
        rate('bot:ranking', 120);
        const params = new URL(request.url, 'http://localhost').searchParams;
        const guildId = params.get('guildId'), userId = params.get('userId') || '';
        if (!/^\d{15,22}$/.test(guildId ?? '') || (userId && !/^\d{15,22}$/.test(userId))) throw new ApiError(400, 'Invalid server or participant');
        send(response, 200, { ...(await store.ranking(`guild:${guildId}:event:${eventId}`, userId)), boardName:eventName }); return;
      }
      if (!configured) throw new ApiError(503, 'Discord profiles are not configured on the game server yet');
      if (pathname === '/api/discord/session' && request.method === 'POST') {
        rate(`auth:${request.socket.remoteAddress}`, 30);
        const input = await jsonBody(request);
        const guildId = input.guildId ?? null;
        if (guildId !== null && (typeof guildId !== 'string' || !/^\d{15,22}$/.test(guildId))) throw new ApiError(400, 'Invalid Discord server');
        let verified;
        try { verified = await verifyDiscord({ code:input.code, guildId }); }
        catch (error) { throw new ApiError(401, error.message); }
        const board = guildId ? `guild:${guildId}:event:${eventId}` : `event:${eventId}`;
        const token = randomBytes(32).toString('base64url');
        const session = { board, profile:verified.profile, expires:now() + verified.expiresIn * 1000,
          boardName:guildId ? `This server · ${eventName}` : eventName };
        for (const [id, value] of sessions) if (value.expires <= now()) sessions.delete(id);
        if (sessions.size >= 10000) throw new ApiError(503, 'Please try connecting again shortly');
        await store.upsertProfile(board, verified.profile);
        const rewards = await store.transaction(board, verified.profile.id, async tx => normalizeRewards((await tx.profile())?.rewards));
        sessions.set(token, session);
        send(response, 200, { token, accessToken:verified.accessToken, profile:verified.profile,
          boardName:session.boardName, expiresAt:session.expires, rewards }); return;
      }
      const session = getSession(request);
      rate(`user:${session.profile.id}`, 120);
      if (pathname === '/api/discord/session' && request.method === 'DELETE') {
        sessions.delete(session.token); send(response, 200, { disconnected:true }); return;
      }
      if (pathname === '/api/leaderboard' && request.method === 'GET') {
        send(response, 200, { ...(await store.ranking(session.board, session.profile.id)), boardName:session.boardName }); return;
      }
      if (pathname === '/api/rewards' && ['GET','PUT'].includes(request.method)) {
        const input = request.method === 'PUT' ? await jsonBody(request) : null;
        if (input && (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'equipped'))) throw new ApiError(400, 'Only cosmetic selections can be updated.');
        const rewards = await store.transaction(session.board, session.profile.id, async tx => {
          const profile = await tx.profile();
          if (!profile) throw new ApiError(401, 'Reconnect your Discord profile to continue');
          if (!input) return normalizeRewards(profile.rewards);
          let selected;
          try { selected = equipRewards(profile.rewards, input.equipped); }
          catch (error) { throw new ApiError(400, error.message); }
          await tx.saveRewards(selected);
          return selected;
        });
        send(response, 200, rewards); return;
      }
      if (pathname === '/api/runs/preview' && request.method === 'GET') {
        const params = new URL(request.url, 'http://localhost').searchParams;
        if ([...params.keys()].some(key => key !== 'restart') || params.has('restart') && params.get('restart') !== '1') throw new ApiError(400, 'Invalid preview option.');
        const restart = params.get('restart') === '1';
        const answer = await store.transaction(session.board, session.profile.id, async tx => {
          const profile = await tx.profile(), existing = await tx.activeAttempt();
          if (existing && !restart && now() - existing.started_at < 3600000) return { config:JSON.parse(existing.config), resume:true };
          const { director, flush } = directorFor(profile), config = director.current({ upgrade:true });
          if (!director.available) throw new ApiError(503, 'Progress could not be saved. Please try again.');
          // A restart preview must not invalidate an existing (possibly legacy)
          // ticket if the player cancels. Its replacement is saved on start.
          if (!existing) await flush(tx);
          return { config, resume:false };
        });
        send(response, 200, answer); return;
      }
      if (pathname === '/api/runs' && request.method === 'POST') {
        const input = await jsonBody(request);
        if (Object.keys(input).some(key => !['restart','character'].includes(key))
          || Object.hasOwn(input, 'restart') && typeof input.restart !== 'boolean'
          || Object.hasOwn(input, 'character') && !['wizard','robot'].includes(input.character)) throw new ApiError(400, 'Choose the wizard or robot.');
        const answer = await store.transaction(session.board, session.profile.id, async tx => {
          const profile = await tx.profile();
          const existing = await tx.activeAttempt();
          if (existing && !input.restart && now() - existing.started_at < 3600000) {
            return { ticket:existing.id, config:JSON.parse(existing.config) };
          }
          if (existing) await tx.abandon(existing.id);
          const { director, flush } = directorFor(profile), config = director.current({ upgrade:true, character:input.character ?? 'wizard' }), ticket = randomUUID();
          if (!director.available) throw new ApiError(503, 'Progress could not be saved. Please try again.');
          await flush(tx);
          await tx.createAttempt(ticket, config, now());
          return { ticket, config };
        });
        send(response, 200, answer); return;
      }
      if (pathname === '/api/runs/finish' && request.method === 'POST') {
        rate(`finish:${session.profile.id}`, 10);
        const input = await jsonBody(request);
        if (typeof input.ticket !== 'string' || input.ticket.length > 64) throw new ApiError(400, 'Invalid attempt');
        const answer = await store.transaction(session.board, session.profile.id, async tx => {
          const attempt = await tx.attempt(input.ticket);
          if (!attempt) throw new ApiError(404, 'Attempt not found');
          if (attempt.result) return { ...JSON.parse(attempt.result), rewards:normalizeRewards((await tx.profile())?.rewards) };
          if (attempt.status !== 'ready') throw new ApiError(409, 'This attempt has been restarted');
          if (now() - attempt.started_at > 3600000) throw new ApiError(409, 'This attempt has expired. Restart the level to continue.');
          const config = JSON.parse(attempt.config);
          let result;
          try { result = replayRun(config, input.trace); }
          catch { throw new ApiError(422, 'This run could not be verified. Restart the level to try again.'); }
          if (result.simulationSeconds > (now() - attempt.started_at) / 1000 + 3) throw new ApiError(422, 'This run finished faster than its verified duration');
          const profile = await tx.profile();
          const { director, flush } = directorFor(profile);
          if (!director.complete(config, result)) throw new ApiError(409, 'The level has already changed');
          if (!director.available) throw new ApiError(503, 'Progress could not be saved. Please try again.');
          await flush(tx);
          const { rewards, newAchievements } = grantRewards(profile.rewards, result);
          if (newAchievements.length) await tx.saveRewards(rewards);
          if (result.status === 'won') await tx.addScore(attempt, config, result, now());
          const ranking = await tx.ranking();
          const answer = { status:result.status, score:result.score, elapsed:result.elapsed, bonuses:result.bonuses, hits:result.hits, level:config.level, rank:ranking.you?.rank ?? null, rewards, newAchievements,
            message:result.status === 'won' ? `Verified · #${ranking.you.rank} on ${session.boardName}` : 'Your level is kept. The challenge stays active, with up to 10 extra seconds on retry.' };
          await tx.finish(attempt.id, result.status, answer);
          return answer;
        });
        send(response, 200, answer); return;
      }
      throw new ApiError(404, 'Endpoint not found');
    } catch (error) {
      if (!error.status) {
        const code = /^[A-Z0-9_]{1,40}$/.test(error?.code ?? '') ? error.code : 'unavailable';
        console.warn(`Forest Trail API request failed: backend=${store.backend} path=${pathname} code=${code}`);
      }
      send(response, error.status ?? 500, { error:error.status ? error.message : 'The game server is unavailable. Please try again.' });
    }
  }
  let closing;
  return { handle, close() {
    sessions.clear();
    return closing ??= (discordBot.pendingCount ? discordBot.whenIdle().finally(() => store.close()) : store.close());
  }, configured, botConfigured:discordBot.configured, whenBotIdle:discordBot.whenIdle };
}
