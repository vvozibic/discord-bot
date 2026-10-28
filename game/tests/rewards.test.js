import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeRewards, equipRewards, grantRewards, DEFAULT_EQUIPPED } from '../src/rewards.js';
import { createSqliteGameStore } from '../server/game-store.js';

const all = ['clean-run','bonus-sweep','hunter-slayer'];

test('only a completed run meeting each condition earns an achievement, once', () => {
  const outcome = { status:'won', hits:0, bonuses:2, bonusCount:2, hunterDefeated:true };
  const first = grantRewards(null, outcome);
  assert.deepEqual(first.newAchievements, all);
  assert.deepEqual(first.rewards, { unlocked:all, equipped:DEFAULT_EQUIPPED });
  assert.deepEqual(grantRewards(first.rewards, outcome).newAchievements, []);
  for (const status of ['running','ready','failed','abandoned']) {
    assert.deepEqual(grantRewards(null, { ...outcome, status }).newAchievements, []);
  }
  assert.deepEqual(grantRewards(null, { ...outcome, hits:1, bonuses:1, hunterDefeated:false }).newAchievements, []);
  for (const bonusCount of [undefined, 0, 1, 3, '2']) {
    assert.equal(grantRewards(null, { ...outcome, bonusCount }).newAchievements.includes('bonus-sweep'), false);
  }
});

test('locked or malformed equipment cannot be selected; corrupted saves reset only invalid fields', () => {
  assert.throws(() => equipRewards(null, { palette:'moonlight', trail:'none', badge:'none' }), /unlock/);
  for (const equipment of [null, [], {}, { palette:'classic', trail:'none' }, { ...DEFAULT_EQUIPPED, extra:'x' }, { ...DEFAULT_EQUIPPED, badge:'unknown' }]) {
    assert.throws(() => equipRewards({ unlocked:all }, equipment), RangeError);
  }
  const rewards = equipRewards({ unlocked:all }, { palette:'moonlight', trail:'spark', badge:'hunter' });
  assert.deepEqual(rewards.equipped, { palette:'moonlight', trail:'spark', badge:'hunter' });
  assert.deepEqual(normalizeRewards('{bad'), { unlocked:[], equipped:DEFAULT_EQUIPPED });
  assert.deepEqual(normalizeRewards({ unlocked:['bonus-sweep','unknown','bonus-sweep'], equipped:{ palette:'moonlight', trail:'spark', badge:'hunter' } }),
    { unlocked:['bonus-sweep'], equipped:{ palette:'classic', trail:'spark', badge:'none' } });
});

test('SQLite migrates pre-rewards profiles additively and persists equipment without touching progress', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'forest-rewards-migration-')), path = join(directory, 'game.sqlite');
  const board = 'old-board', userId = '123456789012345678';
  const old = new DatabaseSync(path);
  old.exec('CREATE TABLE profiles (board TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL,avatar TEXT NOT NULL,progress TEXT,PRIMARY KEY(board,user_id)); CREATE TABLE existing_bot_data (value TEXT); INSERT INTO existing_bot_data VALUES (\'keep\')');
  old.prepare('INSERT INTO profiles VALUES(?,?,?,?,?)').run(board,userId,'Original','','existing-progress');
  old.close();
  let store;
  try {
    store = createSqliteGameStore(path);
    assert.deepEqual(normalizeRewards((await store.transaction(board,userId,tx => tx.profile())).rewards), { unlocked:[], equipped:DEFAULT_EQUIPPED });
    const rewards = equipRewards({ unlocked:all }, { palette:'moonlight',trail:'spark',badge:'hunter' });
    await store.transaction(board,userId,tx => tx.saveRewards(rewards));
    await store.close();
    store = createSqliteGameStore(path);
    await store.upsertProfile(board,{id:userId,name:'Renamed',avatar:''});
    const profile = await store.transaction(board,userId,tx => tx.profile());
    assert.equal(profile.progress,'existing-progress');
    assert.deepEqual(normalizeRewards(profile.rewards),rewards);
    const db = new DatabaseSync(path);
    try { assert.equal(db.prepare('SELECT value FROM existing_bot_data').get().value,'keep'); }
    finally { db.close(); }
  } finally { await store?.close(); rmSync(directory,{recursive:true,force:true}); }
});
