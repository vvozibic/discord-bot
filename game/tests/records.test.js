import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordStore, RECORDS_KEY } from '../src/records.js';

function memoryStorage(initial) {
  const values = new Map(initial ? [[RECORDS_KEY, initial]] : []);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function record(id, options = {}) {
  return { id, mode: 'journey', scope: 'all', seed: 12345, layoutName: 'Fern Hollow', score: 900, elapsed: 50, bonuses: 1, hits: 0, createdAt: '2026-10-17T12:00:00.000Z', ...options };
}

test('level records retain progression metadata and rank higher levels before score', () => {
  const storage = memoryStorage();
  const store = createRecordStore(storage);
  store.add(record('legacy', { score:9999 }));
  store.add(record('level-one', { level:1, tier:0, score:1300 }));
  store.add(record('level-eight', { level:8, tier:4, score:900 }));
  const records = createRecordStore(storage).list();
  assert.deepEqual(records.map(row => row.id), ['level-eight','level-one','legacy']);
  assert.equal(records[0].level, 8);
  assert.equal(records[0].tier, 4);
  assert.equal(store.add(record('invalid', { level:-1 })), false);
});

test('records rank by score then time, cap at ten, and survive reopening', () => {
  const storage = memoryStorage();
  const store = createRecordStore(storage);
  for (let index = 0; index < 14; index++) store.add(record(`run-${index}`, { score: 1000 + index }));
  store.add(record('fast', { score: 1013, elapsed: 20 }));
  const ranked = store.list();
  assert.equal(store.available, true);
  assert.equal(ranked.length, 10);
  assert.equal(ranked[0].id, 'fast');
  assert.equal(ranked[1].id, 'run-13');
  assert.equal(ranked.at(-1).id, 'run-5');
  assert.deepEqual(createRecordStore(storage).list(), ranked);
  ranked[0].score = -999;
  assert.equal(store.list()[0].score, 1013);
});

test('each mode and daily challenge have independent leaderboards', () => {
  const store = createRecordStore(memoryStorage());
  store.add(record('normal'));
  store.add(record('storm', { mode: 'storm', score: 1200 }));
  store.add(record('daily', { scope: 'daily:2026-10-17', score: 1400 }));
  store.add(record('tomorrow', { scope: 'daily:2026-10-18', score: 1500 }));
  store.add(record('storm-daily', { mode: 'storm', scope: 'daily:2026-10-17', score: 1600 }));
  assert.deepEqual(store.list().map(result => result.id), ['normal']);
  assert.deepEqual(store.list({ mode: 'storm' }).map(result => result.id), ['storm']);
  assert.deepEqual(store.list({ scope: 'daily:2026-10-17' }).map(result => result.id), ['daily']);
  assert.deepEqual(store.list({ mode: 'storm', scope: 'daily:2026-10-17' }).map(result => result.id), ['storm-daily']);
  assert.deepEqual(store.list({ scope: 'daily:2026-10-18' }).map(result => result.id), ['tomorrow']);
});

test('a duplicate result is counted once per bucket without replacing its score', () => {
  const store = createRecordStore(memoryStorage());
  store.add(record('same'));
  store.add(record('same', { score: 99999 }));
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].score, 900);
  store.add(record('same', { scope: 'daily:2026-10-17' }));
  assert.equal(store.list({ scope: 'daily:2026-10-17' }).length, 1);
});

test('malformed JSON and schema are ignored without disabling working storage', () => {
  for (const initial of ['{invalid', 'null', JSON.stringify({ version: 9, records: [record('old')] }), JSON.stringify({ version: 1, records: {} })]) {
    const store = createRecordStore(memoryStorage(initial));
    assert.deepEqual(store.list(), []);
    assert.equal(store.available, true);
    assert.equal(store.add(record('new')).length, 1);
  }
  const store = createRecordStore(memoryStorage(JSON.stringify({ version: 1, records: [record('valid'), record('bad', { elapsed: -1 }), null] })));
  assert.deepEqual(store.list().map(result => result.id), ['valid']);
});

test('blocked reads and writes preserve an in-memory leaderboard', () => {
  const unreadable = createRecordStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.equal(unreadable.available, false);
  unreadable.add(record('memory'));
  assert.equal(unreadable.list()[0].id, 'memory');
  const full = createRecordStore({ getItem() { return null; }, setItem() { throw new Error('quota'); } });
  assert.equal(full.available, true);
  full.add(record('quota'));
  assert.equal(full.available, false);
  assert.equal(full.list()[0].id, 'quota');
  full.add(record('second', { score: 1000 }));
  assert.equal(full.list()[0].id, 'second');
  const absent = createRecordStore(null);
  assert.equal(absent.available, false);
  assert.equal(absent.add(record('absent')).length, 1);
});

test('invalid values and impossible daily dates cannot enter the rankings', () => {
  const store = createRecordStore(memoryStorage());
  for (const options of [{ mode: 'global' }, { scope: 'daily:2026-02-30' }, { scope: 'daily:2026-2-3' }, { score: Infinity }, { score: 1.5 }, { score: -1 }, { elapsed: NaN }, { seed: null }, { layoutName: '' }, { createdAt: 'yesterday' }, { bonuses: -1 }, { hits: .5 }]) {
    assert.equal(store.add(record('invalid', options)), false);
  }
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.list({ mode: 'global' }), []);
  assert.deepEqual(store.list({ scope: 'daily:2026-02-30' }), []);
  const result = store.add(record(undefined, { createdAt: undefined, seed: 'daily-seed' }));
  assert.equal(typeof result[0].id, 'string');
  assert.equal(result[0].seed, 'daily-seed');
  assert.equal(Number.isFinite(new Date(result[0].createdAt).getTime()), true);
});
