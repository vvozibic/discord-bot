import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBotStore } from '../server/bot/store.js';

const GUILD = '333333333333333333';
const OTHER_GUILD = '444444444444444444';
const USER = { id:'123456789012345678', name:'Alice' };

test('participation survives reopening the database and repeated joins preserve its date', () => {
  const directory = mkdtempSync(join(tmpdir(), 'forest-trail-bot-'));
  const filename = join(directory, 'bot.sqlite');
  let db = new DatabaseSync(filename);
  try {
    let time = 1000000;
    const store = createBotStore(db, { now:() => time });
    assert.equal(store.participant(GUILD, USER.id), null);
    const participant = store.join(GUILD, USER);
    assert.deepEqual(participant, { guildId:GUILD, userId:USER.id, name:'Alice', joinedAt:time });
    time += 1000;
    assert.deepEqual(store.join(GUILD, { ...USER, name:'New server nickname' }), { ...participant, name:'New server nickname' });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 1);
    db.close();
    db = new DatabaseSync(filename);
    const reopened = createBotStore(db, { now:() => time });
    assert.deepEqual(reopened.participant(GUILD, USER.id), { ...participant, name:'New server nickname' });
  } finally {
    db.close();
    rmSync(directory, { recursive:true, force:true });
  }
});

test('participation remains separate for each guild, event and user', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const first = createBotStore(db, { eventId:'first', now:() => 1000 });
    const second = createBotStore(db, { eventId:'second', now:() => 2000 });
    first.join(GUILD, USER);
    assert.equal(first.participant(OTHER_GUILD, USER.id), null);
    assert.equal(first.participant(GUILD, '223456789012345678'), null);
    assert.equal(second.participant(GUILD, USER.id), null);
    assert.equal(first.join(OTHER_GUILD, USER).joinedAt, 1000);
    assert.equal(second.join(GUILD, USER).joinedAt, 2000);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bot_participants').get().count, 3);
  } finally { db.close(); }
});

test('cached interaction responses survive reopening and expire at fifteen minutes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'forest-trail-bot-cache-'));
  const filename = join(directory, 'bot.sqlite');
  let db = new DatabaseSync(filename);
  try {
    let time = 1000000;
    const response = { type:4, data:{ content:'Joined', flags:64 } };
    const store = createBotStore(db, { now:() => time });
    assert.equal(store.cachedInteraction('interaction-1'), null);
    store.cacheInteraction('interaction-1', response);
    db.close();
    db = new DatabaseSync(filename);
    const reopened = createBotStore(db, { now:() => time });
    assert.deepEqual(reopened.cachedInteraction('interaction-1'), response);
    const copy = reopened.cachedInteraction('interaction-1');
    copy.data.content = 'Changed locally';
    assert.deepEqual(reopened.cachedInteraction('interaction-1'), response);
    time += 15 * 60 * 1000 - 1;
    assert.deepEqual(reopened.cachedInteraction('interaction-1'), response);
    time += 1;
    assert.equal(reopened.cachedInteraction('interaction-1'), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bot_interaction_cache').get().count, 0);
  } finally {
    db.close();
    rmSync(directory, { recursive:true, force:true });
  }
});

test('caching prunes expired responses and keeps campaigns separate', () => {
  const db = new DatabaseSync(':memory:');
  try {
    let time = 1000;
    const first = createBotStore(db, { eventId:'first', now:() => time });
    const second = createBotStore(db, { eventId:'second', now:() => time });
    first.cacheInteraction('same-id', { content:'First campaign' });
    assert.equal(second.cachedInteraction('same-id'), null);
    second.cacheInteraction('same-id', { content:'Second campaign' });
    assert.deepEqual(first.cachedInteraction('same-id'), { content:'First campaign' });
    assert.deepEqual(second.cachedInteraction('same-id'), { content:'Second campaign' });
    first.cacheInteraction('same-id', { content:'Updated response' });
    assert.deepEqual(first.cachedInteraction('same-id'), { content:'Updated response' });
    time += 15 * 60 * 1000;
    first.cacheInteraction('fresh-id', { content:'Fresh response' });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bot_interaction_cache').get().count, 1);
    assert.deepEqual(first.cachedInteraction('fresh-id'), { content:'Fresh response' });
  } finally { db.close(); }
});
