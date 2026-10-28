import { openDatabase, leaderboard } from './database.js';
import { createBotStore } from './bot/store.js';

function serialized() {
  let tail = Promise.resolve();
  return task => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
}

export function createSqliteGameStore(filename, { eventId, now } = {}) {
  const db = openDatabase(filename), exclusive = serialized();
  const originalBotStore = createBotStore(db, { eventId, now });
  const botStore = Object.fromEntries(Object.entries(originalBotStore).map(([name, action]) => [name, (...args) => exclusive(() => action(...args))]));
  let closing;
  return {
    backend:'sqlite', botStore,
    upsertProfile(board, profile) {
      return exclusive(() => db.prepare(`INSERT INTO profiles(board,user_id,name,avatar) VALUES(?,?,?,?)
        ON CONFLICT(board,user_id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar`)
        .run(board, profile.id, profile.name, profile.avatar));
    },
    ranking(board, userId) { return exclusive(() => leaderboard(db, board, userId)); },
    ping() { return exclusive(() => db.prepare('SELECT 1 AS ready').get().ready === 1); },
    transaction(board, userId, action) {
      return exclusive(async () => {
        db.exec('BEGIN IMMEDIATE');
        const tx = {
          profile:() => db.prepare('SELECT progress,rewards FROM profiles WHERE board=? AND user_id=?').get(board, userId),
          activeAttempt:() => db.prepare("SELECT * FROM attempts WHERE board=? AND user_id=? AND status='ready' ORDER BY started_at DESC LIMIT 1").get(board, userId),
          attempt:id => db.prepare('SELECT * FROM attempts WHERE id=? AND board=? AND user_id=?').get(id, board, userId),
          abandon:id => db.prepare("UPDATE attempts SET status='abandoned' WHERE id=? AND board=? AND user_id=?").run(id, board, userId),
          saveProgress:value => db.prepare('UPDATE profiles SET progress=? WHERE board=? AND user_id=?').run(value, board, userId),
          saveRewards:value => db.prepare('UPDATE profiles SET rewards=? WHERE board=? AND user_id=?').run(JSON.stringify(value), board, userId),
          createAttempt:(id, config, startedAt) => db.prepare('INSERT INTO attempts(id,board,user_id,config,started_at) VALUES(?,?,?,?,?)').run(id, board, userId, JSON.stringify(config), startedAt),
          addScore:(attempt, config, result, createdAt) => db.prepare('INSERT INTO scores(attempt_id,board,user_id,level,tier,score,elapsed,layout,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .run(attempt.id, board, userId, config.level, config.tier, result.score, result.elapsed, result.layoutName, createdAt),
          finish:(id, status, result) => db.prepare('UPDATE attempts SET status=?,result=? WHERE id=? AND board=? AND user_id=?').run(status, JSON.stringify(result), id, board, userId),
          ranking:() => leaderboard(db, board, userId),
        };
        try { const result = await action(tx); db.exec('COMMIT'); return result; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      });
    },
    close() { return closing ??= exclusive(() => db.close()); },
  };
}
