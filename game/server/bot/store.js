const INTERACTION_CACHE_MS = 15 * 60 * 1000;

export function createBotStore(db, { eventId = 'tag', now = Date.now } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_participants (
      guild_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY(guild_id, event_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS bot_interaction_cache (
      event_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      response TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY(event_id, interaction_id)
    );
    CREATE INDEX IF NOT EXISTS bot_interaction_cache_expiry ON bot_interaction_cache(expires_at);
  `);

  const findParticipant = db.prepare(`
    SELECT guild_id AS guildId, user_id AS userId, name, joined_at AS joinedAt
    FROM bot_participants WHERE guild_id=? AND event_id=? AND user_id=?
  `);
  const upsertParticipant = db.prepare(`
    INSERT INTO bot_participants(guild_id,event_id,user_id,name,joined_at) VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,event_id,user_id) DO UPDATE SET name=excluded.name
  `);
  const pruneCache = db.prepare('DELETE FROM bot_interaction_cache WHERE expires_at<=?');
  const findInteraction = db.prepare('SELECT response FROM bot_interaction_cache WHERE event_id=? AND interaction_id=? AND expires_at>?');
  const upsertInteraction = db.prepare(`
    INSERT INTO bot_interaction_cache(event_id,interaction_id,response,expires_at) VALUES(?,?,?,?)
    ON CONFLICT(event_id,interaction_id) DO UPDATE SET response=excluded.response, expires_at=excluded.expires_at
  `);

  return {
    join(guildId, user) {
      const name = String(user.name || 'Player').slice(0, 80);
      upsertParticipant.run(guildId, eventId, user.id, name, now());
      return { ...findParticipant.get(guildId, eventId, user.id) };
    },
    participant(guildId, userId) {
      const result = findParticipant.get(guildId, eventId, userId);
      return result ? { ...result } : null;
    },
    cachedInteraction(id) {
      const time = now();
      pruneCache.run(time);
      const cached = findInteraction.get(eventId, id, time);
      return cached ? JSON.parse(cached.response) : null;
    },
    cacheInteraction(id, response) {
      const time = now();
      const serialized = JSON.stringify(response);
      pruneCache.run(time);
      upsertInteraction.run(eventId, id, serialized, time + INTERACTION_CACHE_MS);
    },
  };
}
