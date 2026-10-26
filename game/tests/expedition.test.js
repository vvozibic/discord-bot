import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD, LAYOUTS, SPAWN, PORTAL, POND, BRIDGE, HUT, TREES, PATHS,
  configureWorld, getCurrentLayoutId, createExpedition, canStand, findPath, clearSegment, followPath,
} from '../src/world.js';

afterEach(() => configureWorld());

test('four authored layouts change actual routes, water, landmarks, and obstacle arrangements', () => {
  const geometry = [];
  for (const { id } of LAYOUTS) {
    configureWorld(id);
    assert.equal(getCurrentLayoutId(), id);
    assert.ok(canStand(SPAWN.x, SPAWN.y));
    assert.ok(canStand(PORTAL.x, PORTAL.y));
    assert.equal(canStand(POND.x + 24, POND.y + 40), false);
    assert.ok(clearSegment({ x: BRIDGE.x + BRIDGE.width / 2, y: BRIDGE.y },
      { x: BRIDGE.x + BRIDGE.width / 2, y: BRIDGE.y + BRIDGE.height }));
    assert.ok(findPath(SPAWN, PORTAL).length);
    geometry.push({ pond: { ...POND }, hut: { ...HUT }, trees: TREES.map(tree => ({ ...tree })), paths: PATHS.map(path => [...path]) });
  }
  assert.equal(LAYOUTS.length, 4);
  for (const feature of ['pond', 'hut', 'trees', 'paths']) {
    assert.equal(new Set(geometry.map(layout => JSON.stringify(layout[feature]))).size, 4, `${feature} should differ on each map`);
  }
  assert.deepEqual(WORLD, { width: 768, height: 512 });
  assert.throws(() => configureWorld('missing-layout'), RangeError);
});

test('shared seeds reproduce layouts, objectives, bonuses and hazard timings without shared state', () => {
  for (const { id } of LAYOUTS) {
    const first = createExpedition('a shared forest code', { layoutId: id });
    assert.deepEqual(createExpedition('a shared forest code', { layoutId: id }), first);
    const saved = structuredClone(first);
    first.items[0].x = -100;
    first.bonuses[0].y = -100;
    first.hazards[0].from.x = -100;
    assert.deepEqual(createExpedition('a shared forest code', { layoutId: id }), saved);
  }
  assert.deepEqual(createExpedition(12345), createExpedition(12345));
});

test('new seeds vary objective positions and automatically select all four layouts', () => {
  const layouts = new Set(), placements = new Set();
  for (let seed = 0; seed < 90; seed++) {
    const expedition = createExpedition(seed);
    layouts.add(expedition.layoutId);
    placements.add(JSON.stringify(expedition.items));
  }
  assert.equal(layouts.size, 4);
  assert.ok(placements.size > 85);
  for (const { id } of LAYOUTS) {
    assert.ok(new Set(Array.from({ length: 20 }, (_, seed) => JSON.stringify(createExpedition(seed, { layoutId: id }).items))).size > 18);
  }
});

test('seeded objectives stay readable, spaced apart and continuously reachable on every layout', () => {
  for (const { id } of LAYOUTS) for (let seed = 0; seed < 30; seed++) {
    const expedition = createExpedition(seed, { layoutId: id });
    assert.equal(expedition.items.length, 6);
    assert.equal(expedition.bonuses.length, 2);
    const objectives = [...expedition.items, ...expedition.bonuses];
    for (let i = 0; i < objectives.length; i++) {
      const point = objectives[i];
      assert.ok(canStand(point.x, point.y), `${id}/${seed}: blocked objective`);
      assert.ok(Math.hypot(point.x - SPAWN.x, point.y - SPAWN.y) >= 35);
      assert.ok(Math.hypot(point.x - PORTAL.x, point.y - PORTAL.y) >= 35);
      assert.ok(!TREES.some(tree => Math.abs(point.x - tree.x) < 34 && point.y > tree.y - 48 && point.y < tree.y + 50), 'Objective hidden by canopy');
      assert.ok(!(point.x > HUT.x - 28 && point.x < HUT.x + HUT.width + 28
        && point.y > HUT.y - 24 && point.y < HUT.y + HUT.height + 40), 'Objective hidden by hut');
      const path = findPath(SPAWN, point);
      assert.ok(path.length, `${id}/${seed}: unreachable objective ${JSON.stringify(point)}`);
      let previous = SPAWN;
      for (const waypoint of path) { assert.ok(clearSegment(previous, waypoint)); previous = waypoint; }
      assert.deepEqual(path.at(-1), point);
      for (const other of objectives.slice(i + 1)) assert.ok(Math.hypot(point.x - other.x, point.y - other.y) >= 40);
    }
    for (const hazard of expedition.hazards) {
      assert.ok(clearSegment(hazard.from, hazard.to));
      assert.ok(findPath(SPAWN, hazard.from).length);
      assert.ok(hazard.period >= 6 && hazard.period <= 10);
      assert.ok(hazard.phase >= 0 && hazard.phase < 2 * Math.PI);
    }
    assert.equal(expedition.hazards.length, 2);
  }
});

test('switching layouts refreshes water collision and route walkability, including revisits', () => {
  const crossingLand = { x: 104, y: 216 }, lakesideLand = { x: 648, y: 120 };
  for (let revisit = 0; revisit < 3; revisit++) {
    configureWorld('crossing');
    assert.ok(findPath(SPAWN, crossingLand).length);
    assert.deepEqual(findPath(SPAWN, lakesideLand), []);
    configureWorld('waterside');
    assert.deepEqual(findPath(SPAWN, crossingLand), []);
    assert.ok(findPath(SPAWN, lakesideLand).length);
    configureWorld('switchback');
    const player = { ...SPAWN }, path = findPath(player, PORTAL);
    let steps = 0;
    while (path.length && steps++ < 1800) {
      assert.ok(followPath(player, path, 1 / 30));
      assert.ok(canStand(player.x, player.y));
    }
    assert.ok(Math.hypot(player.x - PORTAL.x, player.y - PORTAL.y) < .01);
  }
});
