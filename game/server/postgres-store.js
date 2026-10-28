import { Pool } from 'pg';
import { normalizeRewards } from '../src/rewards.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS forest_profiles (
    board TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL,
    progress TEXT, rewards TEXT, PRIMARY KEY(board,user_id));
  ALTER TABLE forest_profiles ADD COLUMN IF NOT EXISTS rewards TEXT;
  CREATE TABLE IF NOT EXISTS forest_attempts (
    id TEXT PRIMARY KEY, board TEXT NOT NULL, user_id TEXT NOT NULL, config TEXT NOT NULL,
    started_at BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'ready', result TEXT);
  CREATE INDEX IF NOT EXISTS forest_active_attempts ON forest_attempts(board,user_id,status);
  CREATE TABLE IF NOT EXISTS forest_scores (
    attempt_id TEXT PRIMARY KEY, board TEXT NOT NULL, user_id TEXT NOT NULL,
    level INTEGER NOT NULL, tier INTEGER NOT NULL, score INTEGER NOT NULL,
    elapsed DOUBLE PRECISION NOT NULL, layout TEXT NOT NULL, created_at BIGINT NOT NULL);
  CREATE INDEX IF NOT EXISTS forest_board_scores ON forest_scores(board,user_id,level DESC,score DESC,elapsed);
`;

async function ranking(query, board, userId) {
  const { rows } = await query(`WITH best AS (
    SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.level DESC,s.score DESC,s.elapsed,s.created_at,s.attempt_id) AS choice
    FROM forest_scores s WHERE s.board=$1
  ), ranked AS (
    SELECT b.user_id AS "userId",p.name,p.avatar,p.rewards,b.level,b.tier,b.score,b.elapsed,b.layout,
      ROW_NUMBER() OVER (ORDER BY b.level DESC,b.score DESC,b.elapsed,b.created_at,b.user_id) AS rank
    FROM best b JOIN forest_profiles p ON p.board=b.board AND p.user_id=b.user_id WHERE b.choice=1
  ) SELECT * FROM ranked WHERE rank<=25 OR "userId"=$2 ORDER BY rank`, [board, userId]);
  const normalized = rows.map(({ rewards, ...row }) => ({ ...row, rank:Number(row.rank), badge:normalizeRewards(rewards).equipped.badge }));
  const total = await query('SELECT COUNT(DISTINCT user_id) AS total FROM forest_scores WHERE board=$1', [board]);
  return { rows:normalized.filter(row => row.rank <= 25), you:normalized.find(row => row.userId === userId) ?? null,
    total:Number(total.rows[0].total) };
}

export async function openPostgresGameStore(databaseUrl, { PoolClass = Pool } = {}) {
  const pool = new PoolClass({ connectionString:databaseUrl, application_name:'forest-trail-game', max:5, connectionTimeoutMillis:5000, statement_timeout:15000 });
  pool.on('error', () => console.warn('Forest Trail database connection was interrupted; credentials are not logged.'));
  try {
    const client = await pool.connect();
    let discard;
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('forest_trail_schema_v1'), 0)");
      await client.query(SCHEMA);
      await client.query('COMMIT');
    } catch (error) { try { await client.query('ROLLBACK'); } catch (failedRollback) { discard = failedRollback; } throw error; }
    finally { client.release(discard); }
  } catch (original) {
    await pool.end().catch(() => {});
    const error = new Error('The game database could not be initialized.');
    if (/^[A-Z0-9_]{1,40}$/.test(original?.code ?? '')) error.code = original.code;
    throw error;
  }
  const query = pool.query.bind(pool);
  let closing;
  return {
    backend:'postgres',
    async upsertProfile(board, profile) {
      await query(`INSERT INTO forest_profiles(board,user_id,name,avatar) VALUES($1,$2,$3,$4)
        ON CONFLICT(board,user_id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar`,
      [board, profile.id, profile.name, profile.avatar]);
    },
    ranking:(board, userId) => ranking(query, board, userId),
    async ping() { await query('SELECT 1'); return true; },
    async transaction(board, userId, action) {
      const client = await pool.connect(), q = client.query.bind(client);
      let discard;
      try {
        await q('BEGIN');
        await q("SET LOCAL lock_timeout='5s'");
        const profile = (await q('SELECT progress,rewards FROM forest_profiles WHERE board=$1 AND user_id=$2 FOR UPDATE', [board, userId])).rows[0];
        const tx = {
          profile:() => profile,
          activeAttempt:async () => (await q("SELECT * FROM forest_attempts WHERE board=$1 AND user_id=$2 AND status='ready' ORDER BY started_at DESC LIMIT 1", [board, userId])).rows[0],
          attempt:async id => (await q('SELECT * FROM forest_attempts WHERE id=$1 AND board=$2 AND user_id=$3', [id, board, userId])).rows[0],
          abandon:id => q("UPDATE forest_attempts SET status='abandoned' WHERE id=$1 AND board=$2 AND user_id=$3", [id, board, userId]),
          saveProgress:value => q('UPDATE forest_profiles SET progress=$1 WHERE board=$2 AND user_id=$3', [value, board, userId]),
          saveRewards:value => q('UPDATE forest_profiles SET rewards=$1 WHERE board=$2 AND user_id=$3', [JSON.stringify(value), board, userId]),
          createAttempt:(id, config, startedAt) => q('INSERT INTO forest_attempts(id,board,user_id,config,started_at) VALUES($1,$2,$3,$4,$5)', [id, board, userId, JSON.stringify(config), Math.trunc(startedAt)]),
          addScore:(attempt, config, result, createdAt) => q('INSERT INTO forest_scores(attempt_id,board,user_id,level,tier,score,elapsed,layout,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [attempt.id, board, userId, config.level, config.tier, result.score, result.elapsed, result.layoutName, Math.trunc(createdAt)]),
          finish:(id, status, result) => q('UPDATE forest_attempts SET status=$1,result=$2 WHERE id=$3 AND board=$4 AND user_id=$5', [status, JSON.stringify(result), id, board, userId]),
          ranking:() => ranking(q, board, userId),
        };
        const result = await action(tx);
        await q('COMMIT');
        return result;
      } catch (error) { try { await q('ROLLBACK'); } catch (failedRollback) { discard = failedRollback; } throw error; }
      finally { client.release(discard); }
    },
    close() { return closing ??= pool.end(); },
  };
}
