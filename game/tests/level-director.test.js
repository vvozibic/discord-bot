import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevelDirector, describeLevel, PROGRESS_KEY } from '../src/level-director.js';
import { createExpedition, SPAWN, PORTAL, findPath, clearSegment } from '../src/world.js';

function memoryStorage() {
  const data = new Map();
  return { getItem:key => data.get(key) ?? null, setItem:(key, value) => data.set(key, value) };
}
function win(config, elapsed = 30, hits = 0) { return { status:'won', elapsed, hits, timeLimit:config.timeLimit }; }
function legacyStorage({ level = 1, tier = 0, layoutId = 'crossing', attempt = 0, rulesVersion } = {}) {
  const storage = memoryStorage(), active = { level, tier, layoutId, attempt, status:'ready' };
  if (rulesVersion !== undefined) active.rulesVersion = rulesVersion;
  storage.setItem(PROGRESS_KEY, JSON.stringify({ version:1, seed:'legacy-campaign', level, skill:tier, streak:0, attempt, recentMaps:[], active }));
  return storage;
}
const EXPECTED = [
  { timeLimit:70, count:2, patrolSpeed:.95, shieldCharges:2, maxHits:4 },
  { timeLimit:65, count:2, patrolSpeed:1.05, shieldCharges:2, maxHits:4 },
  { timeLimit:60, count:3, patrolSpeed:1.12, shieldCharges:1, maxHits:3 },
  { timeLimit:55, count:3, patrolSpeed:1.2, shieldCharges:1, maxHits:3 },
  { timeLimit:50, count:4, patrolSpeed:1.3, shieldCharges:1, maxHits:3 },
  { timeLimit:45, count:4, patrolSpeed:1.4, shieldCharges:1, maxHits:3 },
];

test('new campaigns start with timed danger, finite armor and all trial mechanics, and resume exactly', () => {
  const storage = memoryStorage(), director = createLevelDirector({ storage, seed:'first-trail' }), first = director.current();
  assert.equal(first.level, 1);
  assert.equal(first.rulesVersion, 13);
  assert.equal(first.character, 'wizard'); assert.equal(first.variant, 'pursuit');
  assert.equal(first.mode, 'storm');
  assert.equal(first.timeLimit, 70);
  assert.equal(first.scoreTimeLimit, 70);
  assert.equal(first.enemies.length, 2);
  assert.equal(first.shieldCharges, 1);
  assert.equal(first.maxHits, 4);
  assert.deepEqual(first.mechanics, { orderedCoins:true, pulseTraps:true, alarm:true, armor:true, exitWindow:true, lava:true, crumble:true, lasers:true, hunter:true, dash:true });
  assert.match(first.id, /:hard-v13:(pursuit|machinery):wizard$/);
  assert.deepEqual(director.current(), first);
  assert.deepEqual(createLevelDirector({ storage }).current(), first);
  director.current().enemies.push('sentinel'); director.current().mechanics.alarm = false;
  assert.deepEqual(director.current(), first, 'callers cannot mutate later plans');
});

test('every level raises bounded pressure even after slow, damaged wins and avoids recent maps', () => {
  const director = createLevelDirector({ storage:null, seed:'progression' }), recent = [], enemies = new Set();
  for (let level = 1; level <= 25; level++) {
    const config = director.current(), tier = Math.min(5, level - 1), expected = EXPECTED[tier];
    assert.equal(config.level, level); assert.equal(config.tier, tier);
    assert.ok(!recent.slice(-2).includes(config.layoutId));
    for (const key of ['timeLimit','patrolSpeed','maxHits']) assert.equal(config[key], expected[key], `level ${level}: ${key}`);
    assert.equal(config.scoreTimeLimit, expected.timeLimit, `level ${level}: scoring deadline`);
    assert.equal(config.shieldCharges, 1);
    assert.equal(config.enemies.length, level === 2 ? 4 : expected.count);
    config.enemies.forEach(type => enemies.add(type)); recent.push(config.layoutId);
    assert.equal(director.complete(config, win(config, config.timeLimit - 1, config.maxHits - 1)), true);
  }
  assert.equal(new Set(recent).size, 4);
  assert.deepEqual([...enemies].sort(), ['scout','sentinel','wisp']);
});

test('retries retain map, objectives, enemies and mechanics with at most ten extra seconds', () => {
  const storage = memoryStorage(), director = createLevelDirector({ storage, seed:'retry-challenge' });
  for (let index = 0; index < 5; index++) { const config = director.current(); director.complete(config, win(config)); }
  const difficult = director.current(), cubes = createExpedition(difficult.seed, { layoutId:difficult.layoutId, hazardCount:difficult.enemies.length }).items;
  let previousId = difficult.id;
  for (let attempt = 1; attempt <= 8; attempt++) {
    assert.equal(director.complete(director.current(), { status:'failed' }), true);
    const retry = director.current();
    for (const key of ['level','layoutId','seed','tier','shieldCharges','maxHits','patrolSpeed','scoreTimeLimit']) assert.equal(retry[key], difficult[key], key);
    assert.notEqual(retry.id, previousId); assert.equal(retry.attempt, attempt);
    assert.deepEqual(retry.enemies, difficult.enemies); assert.deepEqual(retry.mechanics, difficult.mechanics);
    assert.equal(retry.timeLimit, difficult.timeLimit + 10);
    assert.deepEqual(createLevelDirector({ storage }).current(), retry);
    assert.deepEqual(createExpedition(retry.seed, { layoutId:retry.layoutId, hazardCount:retry.enemies.length }).items, cubes);
    previousId = retry.id;
  }
});

test('stale results cannot advance progression twice and restarts never skip levels', () => {
  const director = createLevelDirector({ storage:null, seed:'duplicates' }), first = director.current();
  for (let index = 0; index < 20; index++) assert.deepEqual(director.current(), first);
  assert.equal(director.complete(first, { status:'running' }), false);
  assert.equal(director.complete(first, win(first)), true);
  assert.equal(director.complete(first, win(first)), false);
  const second = director.current(); assert.equal(second.level, 2);
  assert.equal(director.complete(first, win(first)), false);
  assert.deepEqual(director.current(), second);
});

test('character bindings survive reloads and variants alternate by level without changing on retry', () => {
  const storage = memoryStorage(), director = createLevelDirector({ storage, seed:'character-variants' });
  assert.throws(() => director.current({ character:'hunter' }), /wizard or robot/);
  const wizard = director.current(), robot = director.current({ character:'robot' });
  assert.equal(robot.character, 'robot'); assert.equal(robot.variant, 'pursuit');
  assert.notEqual(robot.id, wizard.id);
  assert.deepEqual(createLevelDirector({ storage }).current(), robot);
  assert.equal(director.complete(wizard, win(wizard)), false);
  assert.equal(director.complete({ ...robot, character:'wizard' }, win(robot)), false);
  assert.equal(director.complete({ ...robot, variant:'machinery' }, win(robot)), false);
  assert.equal(director.complete(robot, { status:'failed' }), true);
  const retry = director.current({ character:'robot' });
  assert.equal(retry.variant, robot.variant); assert.equal(retry.seed, robot.seed);
  assert.equal(retry.timeLimit, 80); assert.equal(retry.scoreTimeLimit, 70);
  assert.equal(director.complete(retry, win(retry)), true);
  for (let level = 2; level <= 6; level++) {
    const config = director.current({ character:level % 2 ? 'wizard' : 'robot' });
    assert.equal(config.variant, level % 2 ? 'pursuit' : 'machinery');
    assert.equal(director.complete(config, win(config)), true);
  }
});

test('a win after retry assistance starts the next level with its own base scoring deadline', () => {
  const storage = memoryStorage(), director = createLevelDirector({ storage, seed:'retry-score-transition' });
  const first = director.current();
  director.complete(first, { status:'failed' });
  const retry = director.current();
  assert.equal(retry.timeLimit, 80); assert.equal(retry.scoreTimeLimit, 70);
  assert.equal(director.complete(retry, win(retry, 75)), true);
  const next = director.current();
  assert.equal(next.level, 2); assert.equal(next.attempt, 0);
  assert.equal(next.timeLimit, 65); assert.equal(next.scoreTimeLimit, 65);
  assert.deepEqual(createLevelDirector({ storage }).current(), next);
});

test('level two uses Rustworks and retains its challenge through repeated failures', () => {
  for (let seed = 0; seed < 20; seed++) {
    const director = createLevelDirector({ storage:null, seed:`factory-${seed}` }), first = director.current();
    assert.notEqual(first.layoutId, 'rustworks'); director.complete(first, win(first, 69, 3));
    const second = director.current();
    assert.equal(second.layoutId, 'rustworks'); assert.equal(second.tier, 1);
    assert.equal(second.timeLimit, 65); assert.deepEqual(second.enemies, ['wisp','scout','sentinel','scout']);
    assert.match(second.challengeName, /Rustworks/);
    for (let attempt = 0; attempt < 4; attempt++) {
      director.complete(director.current(), { status:'failed' }); const retry = director.current();
      assert.equal(retry.layoutId, 'rustworks'); assert.equal(retry.timeLimit, 75);
      assert.deepEqual(retry.enemies, second.enemies); assert.equal(retry.tier, 1);
    }
  }
});

test('missing or explicit version one preserves outstanding legacy configurations and ids', () => {
  const cases = [
    { level:1, tier:0, layoutId:'crossing', attempt:0, id:'legacy-campaign:level:1:attempt:0', timeLimit:null, enemies:[], shieldCharges:0 },
    { level:2, tier:1, layoutId:'rustworks', attempt:0, id:'legacy-campaign:level:2:attempt:0:rustworks-v1', timeLimit:180, enemies:['wisp','wisp'], shieldCharges:3 },
    { level:2, tier:0, layoutId:'crossing', attempt:0, id:'legacy-campaign:level:2:attempt:0', timeLimit:null, enemies:[], shieldCharges:0 },
    { level:5, tier:3, layoutId:'waterside', attempt:2, id:'legacy-campaign:level:5:attempt:2', timeLimit:150, enemies:['sentinel','scout'], shieldCharges:3 },
  ];
  for (const fixture of cases) for (const rulesVersion of [undefined,1]) {
    const storage = legacyStorage({ ...fixture, rulesVersion }), director = createLevelDirector({ storage });
    const originalSave = storage.getItem(PROGRESS_KEY), config = director.current();
    assert.equal(config.rulesVersion, 1);
    for (const key of ['id','level','tier','layoutId','attempt','timeLimit','shieldCharges']) assert.equal(config[key], fixture[key], key);
    assert.deepEqual(config.enemies, fixture.enemies);
    assert.equal(config.maxHits, undefined); assert.equal(config.mechanics, undefined);
    assert.equal(storage.getItem(PROGRESS_KEY), originalSave, 'reading a pending legacy run must not rewrite it');
    assert.deepEqual(createLevelDirector({ storage }).current(), config);
    assert.equal(director.complete(config, win(config)), true, 'an outstanding legacy result remains accepted');
    const next = director.current();
    assert.equal(next.level, fixture.level + 1); assert.equal(next.rulesVersion, 13);
    assert.equal(next.tier, Math.min(5, fixture.level));
  }
});

test('pending version-two through version-twelve plans retain their original settings, mechanics and exact ids', () => {
  const enemies = [['wisp','scout'], ['wisp','scout'], ['wisp','scout','sentinel'], ['sentinel','scout','scout'],
    ['sentinel','scout','wisp','scout'], ['sentinel','scout','sentinel','scout']];
  const names = ['Relay gauntlet','Pressure patrol','Danger circuit','Alarm pursuit','Critical route','Overload frontier'];
  for (const rulesVersion of [2,3,4,5,6,7,8,9,10,11,12]) for (let tier = 0; tier <= 5; tier++) for (const attempt of [0,2]) {
    const level = tier + 1, layoutId = level === 2 ? 'rustworks' : 'crossing';
    const storage = legacyStorage({ level, tier, layoutId, attempt, rulesVersion });
    const saved = storage.getItem(PROGRESS_KEY), director = createLevelDirector({ storage });
    const config = director.current(), expected = EXPECTED[tier];
    assert.deepEqual(config, {
      id:`legacy-campaign:level:${level}:attempt:${attempt}:hard-v${rulesVersion}`, seed:`legacy-campaign:level:${level}`, layoutId,
      level, tier, attempt, rulesVersion,
      challengeName:`${layoutId === 'rustworks' ? 'Rustworks' : 'Hard trail'} · ${names[tier]}`,
      mode:'storm', scope:'all', enemies:rulesVersion >= 10 && level === 2 ? ['wisp','scout','sentinel','scout'] : enemies[tier], patrolSpeed:expected.patrolSpeed,
      timeLimit:expected.timeLimit + (attempt ? 10 : 0), ...(rulesVersion >= 12 ? { scoreTimeLimit:expected.timeLimit } : {}), shieldCharges:rulesVersion >= 5 ? 1 : expected.shieldCharges, maxHits:expected.maxHits,
      mechanics:{ orderedCoins:true, pulseTraps:true, alarm:true, armor:true, exitWindow:true,
        ...(rulesVersion >= 3 ? { lava:true, crumble:true, lasers:true, hunter:true, dash:true } : {}) },
    });
    assert.equal(storage.getItem(PROGRESS_KEY), saved, `a pending v${rulesVersion} ticket must not be rewritten by inspection`);
    assert.deepEqual(createLevelDirector({ storage }).current(), config);
    assert.equal(director.complete(config, win(config)), true, `outstanding v${rulesVersion} results remain valid`);
    assert.equal(director.current().rulesVersion, 13);
  }
});

test('explicitly upgrading an older hard plan preserves its landscape and gives one elder shield', () => {
  for (const rulesVersion of [2,3,4,5,6,7,8,9,10,11,12]) for (const fixture of [
    { level:6, tier:5, layoutId:'waterside', attempt:1 },
    { level:2, tier:0, layoutId:'crossing', attempt:0 },
  ]) {
    const storage = legacyStorage({ ...fixture, rulesVersion });
    const director = createLevelDirector({ storage }), old = director.current(), upgraded = director.current({ upgrade:true });
    for (const key of ['level','seed','attempt','layoutId','tier','timeLimit','maxHits','patrolSpeed']) assert.equal(upgraded[key], old[key], key);
    assert.equal(upgraded.shieldCharges, 1);
    if (upgraded.level === 2) assert.deepEqual(upgraded.enemies, ['wisp','scout','sentinel','scout']);
    else assert.deepEqual(upgraded.enemies, old.enemies);
    assert.equal(upgraded.rulesVersion, 13);
    assert.equal(upgraded.scoreTimeLimit, EXPECTED[upgraded.tier].timeLimit);
    assert.match(upgraded.id, /:hard-v13:(pursuit|machinery):wizard$/);
    assert.equal(Object.keys(upgraded.mechanics).length, 10);
    assert.deepEqual(director.current({ upgrade:true }), upgraded, 'upgrading an already current plan is idempotent');
    assert.deepEqual(createLevelDirector({ storage }).current(), upgraded, 'version-thirteen saves resume exactly');
    assert.equal(director.complete(old, win(old)), false);
    assert.equal(director.complete(upgraded, win(upgraded)), true);
  }
});

test('explicit upgrade replaces only the ready plan at the same level and invalidates its old result', () => {
  const storage = legacyStorage({ level:2, tier:0, layoutId:'crossing', attempt:2 });
  const director = createLevelDirector({ storage }), legacy = director.current(), upgraded = director.current({ upgrade:true });
  for (const key of ['level','seed','attempt']) assert.equal(upgraded[key], legacy[key], key);
  assert.equal(upgraded.layoutId, 'rustworks'); assert.equal(upgraded.rulesVersion, 13);
  assert.equal(upgraded.tier, 1); assert.equal(upgraded.timeLimit, 75);
  assert.notEqual(upgraded.id, legacy.id);
  assert.equal(director.complete(legacy, win(legacy)), false);
  assert.deepEqual(director.current({ upgrade:true }), upgraded);
  assert.deepEqual(createLevelDirector({ storage }).current(), upgraded);
  assert.equal(director.complete(upgraded, win(upgraded)), true);
  const third = director.current();
  assert.equal(third.level, 3); assert.equal(third.rulesVersion, 13); assert.equal(third.tier, 2);
});

test('new plans from completed or failed legacy saves use hard rules without resetting campaign', () => {
  for (const status of ['won','failed']) {
    const storage = legacyStorage({ level:5, tier:0, layoutId:'switchback', attempt:3 }), saved = JSON.parse(storage.getItem(PROGRESS_KEY));
    saved.active.status = status;
    if (status === 'won') { saved.level++; saved.attempt = 0; } else saved.attempt++;
    storage.setItem(PROGRESS_KEY, JSON.stringify(saved));
    const config = createLevelDirector({ storage }).current();
    assert.equal(config.level, saved.level); assert.equal(config.rulesVersion, 13);
    assert.equal(config.tier, Math.min(5, saved.level - 1)); assert.equal(config.attempt, saved.attempt);
    if (status === 'failed') assert.equal(config.layoutId, 'switchback');
  }
});

test('invalid saves, unsupported rules and unavailable storage leave a playable in-memory campaign', () => {
  const unsupported = JSON.parse(legacyStorage({ rulesVersion:14 }).getItem(PROGRESS_KEY));
  for (const raw of ['{bad', 'null', '{"version":1,"level":-1}', JSON.stringify(unsupported), JSON.stringify({ version:1, seed:'x', level:1, skill:0, streak:0, attempt:0, recentMaps:[], active:{} })]) {
    const storage = memoryStorage(); storage.setItem(PROGRESS_KEY, raw);
    const config = createLevelDirector({ storage, seed:'fallback' }).current();
    assert.equal(config.level, 1); assert.equal(config.rulesVersion, 13); assert.match(config.seed, /^fallback:/);
  }
  const director = createLevelDirector({ storage:{ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } }), first = director.current();
  assert.equal(director.available, false); assert.equal(director.complete(first, win(first)), true);
  assert.equal(director.current().level, 2);
});

test('hard plans produce reachable objectives and up to four safe patrol routes on every map', () => {
  for (let seed = 0; seed < 18; seed++) {
    const director = createLevelDirector({ storage:null, seed:`routes-${seed}` });
    for (let level = 1; level <= 9; level++) {
      const config = director.current(), expedition = createExpedition(config.seed, { layoutId:config.layoutId, hazardCount:config.enemies.length });
      assert.equal(expedition.hazards.length, config.enemies.length); assert.ok(findPath(SPAWN, PORTAL).length);
      for (const item of [...expedition.items, ...expedition.bonuses]) assert.ok(findPath(SPAWN, item).length);
      for (const hazard of expedition.hazards) assert.ok(clearSegment(hazard.from, hazard.to));
      director.complete(config, win(config));
    }
  }
});

test('descriptions show the armor limit, deadline and singular shield', () => {
  const director = createLevelDirector({ storage:null, seed:'description' });
  assert.equal(describeLevel(director.current()), '2 patrols · 1 shield from elder · 4-hit limit · 70 seconds');
  for (let index = 0; index < 2; index++) { const config = director.current(); director.complete(config, win(config)); }
  assert.equal(describeLevel(director.current()), '3 patrols · 1 shield from elder · 3-hit limit · 60 seconds');
  const practice = director.current(); practice.mechanics.armor = false;
  assert.equal(describeLevel(practice), '3 patrols · 1 shield from elder · 60 seconds');
  assert.equal(describeLevel(createLevelDirector({ storage:legacyStorage() }).current()), 'A peaceful trail · no time limit');
});
