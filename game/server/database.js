import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeRewards } from '../src/rewards.js';

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive:true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS profiles (board TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL, progress TEXT, rewards TEXT, PRIMARY KEY(board,user_id));
    CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, board TEXT NOT NULL, user_id TEXT NOT NULL, config TEXT NOT NULL, started_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ready', result TEXT);
    CREATE INDEX IF NOT EXISTS active_attempts ON attempts(board,user_id,status);
    CREATE TABLE IF NOT EXISTS scores (attempt_id TEXT PRIMARY KEY, board TEXT NOT NULL, user_id TEXT NOT NULL, level INTEGER NOT NULL, tier INTEGER NOT NULL, score INTEGER NOT NULL, elapsed REAL NOT NULL, layout TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS board_scores ON scores(board,user_id,level DESC,score DESC,elapsed);
  `);
  // Additive migration: existing progress, attempts and bot tables stay intact.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('PRAGMA table_info(profiles)').all().some(column => column.name === 'rewards')) db.exec('ALTER TABLE profiles ADD COLUMN rewards TEXT');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  return db;
}

export function leaderboard(db, board, userId) {
  const rows = db.prepare(`WITH best AS (
    SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.level DESC,s.score DESC,s.elapsed,s.created_at,s.attempt_id) AS choice FROM scores s WHERE s.board=?
  ), ranked AS (
    SELECT b.user_id AS userId,p.name,p.avatar,p.rewards,b.level,b.tier,b.score,b.elapsed,b.layout,
      ROW_NUMBER() OVER (ORDER BY b.level DESC,b.score DESC,b.elapsed,b.created_at,b.user_id) AS rank
    FROM best b JOIN profiles p ON p.board=b.board AND p.user_id=b.user_id WHERE b.choice=1
  ) SELECT * FROM ranked WHERE rank<=25 OR userId=? ORDER BY rank`).all(board, userId)
    .map(({ rewards, ...row }) => ({ ...row, badge:normalizeRewards(rewards).equipped.badge }));
  return { rows:rows.filter(row => row.rank <= 25), you:rows.find(row => row.userId === userId) ?? null,
    total:db.prepare('SELECT COUNT(DISTINCT user_id) AS total FROM scores WHERE board=?').get(board).total };
}
