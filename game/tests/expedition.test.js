import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD, LAYOUTS, SPAWN, PORTAL, POND, BRIDGE, BASINS, HUT, GUARDIAN, TREES, PATHS, COLLECTIBLES,
  configureWorld, getCurrentLayoutId, createExpedition, canStand, findPath, clearSegment, followPath,
} from '../src/world.js';

afterEach(() => configureWorld());

const NEW_MAP_IDS = ['desert-ruins', 'ice-cavern', 'volcanic-isles', 'mushroom-marsh', 'neon-district',
  'lunar-outpost', 'cloud-citadel', 'coral-sanctum', 'crystal-depths', 'clockwork-vault'];

test('ten new authored maps retain the original four and provide distinct playable geometry', () => {
  const originals = ['crossing', 'waterside', 'switchback', 'rustworks'];
  assert.equal(LAYOUTS.length, 14);
  assert.deepEqual(LAYOUTS.map(({ id }) => id).sort(), [...originals, ...NEW_MAP_IDS].sort());
  const environments = LAYOUTS.filter(({ id }) => NEW_MAP_IDS.includes(id));
  assert.equal(new Set(environments.map(({ theme }) => theme)).size, 10);
  for (const { id, theme } of environments) assert.equal(theme, id, `${id}: distinct environment artwork`);
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
    assert.equal(COLLECTIBLES.length, 6);
    for (const destination of [...COLLECTIBLES, { x:GUARDIAN.x, y:GUARDIAN.y + 25 }, PORTAL]) {
      assert.ok(canStand(destination.x, destination.y), `${id}: blocked landmark ${JSON.stringify(destination)}`);
      const path = findPath(SPAWN, destination);
      assert.ok(path.length, `${id}: unreachable landmark ${JSON.stringify(destination)}`);
      let previous = SPAWN;
      for (const waypoint of path) {
        assert.ok(clearSegment(previous, waypoint), `${id}: blocked landmark route`);
        previous = waypoint;
      }
      assert.deepEqual(path.at(-1), destination);
    }
    geometry.push({ pond: { ...POND }, hut: { ...HUT }, trees: TREES.map(tree => ({ ...tree })), paths: PATHS.map(path => [...path]) });
  }
  for (const feature of ['pond', 'hut', 'trees', 'paths']) {
    assert.equal(new Set(geometry.map(layout => JSON.stringify(layout[feature]))).size, LAYOUTS.length, `${feature} should differ on each map`);
  }
  assert.deepEqual(WORLD, { width: 768, height: 512 });
  assert.throws(() => configureWorld('missing-layout'), RangeError);
});

test('every basin blocks both banks while its bridge remains continuously traversable', () => {
  let secondaryBasins = 0;
  for (const { id } of LAYOUTS) {
    configureWorld(id);
    secondaryBasins += BASINS.length - 1;
    for (const [index, basin] of BASINS.entries()) {
      const { x, y, width, height, bridge } = basin;
      const centerY = y + height / 2, bridgeX = bridge.x + bridge.width / 2;
      assert.equal(canStand((x + bridge.x) / 2, centerY), false, `${id}/${index}: left basin bank`);
      assert.equal(canStand((bridge.x + bridge.width + x + width) / 2, centerY), false, `${id}/${index}: right basin bank`);
      assert.ok(clearSegment({ x:bridgeX, y:bridge.y }, { x:bridgeX, y:bridge.y + bridge.height }),
        `${id}/${index}: bridge crossing`);
      const player = { x:bridgeX, y:bridge.y }, path = [{ x:bridgeX, y:bridge.y + bridge.height }];
      let steps = 0;
      while (path.length && steps++ < 300) {
        assert.ok(followPath(player, path, 1 / 60), `${id}/${index}: crossing movement stopped`);
        assert.ok(canStand(player.x, player.y));
      }
      assert.equal(path.length, 0, `${id}/${index}: incomplete crossing`);
    }
  }
  assert.ok(secondaryBasins >= 3, 'several environments have additional crossings');
});

test('reconfiguring the world restores independent basin and nested bridge definitions', () => {
  for (const id of NEW_MAP_IDS) {
    configureWorld(id);
    const saved = structuredClone(BASINS);
    BASINS[0].x = -100;
    BASINS[0].bridge.width = 1000;
    if (BASINS.length > 1) { BASINS[1].y = -100; BASINS[1].bridge.x = -100; }
    BASINS.push({ x:-100, y:-100, width:1000, height:1000, bridge:{} });
    configureWorld('crossing');
    assert.equal(BASINS.length, 1);
    configureWorld(id);
    assert.deepEqual(BASINS, saved, `${id}: caller mutations must not alter authored basin geometry`);
  }
});

test('the ten new maps allow continuous collision-safe movement through every authored landmark', () => {
  for (const id of NEW_MAP_IDS) {
    configureWorld(id);
    const player = { ...SPAWN };
    for (const destination of [...COLLECTIBLES, { x:GUARDIAN.x, y:GUARDIAN.y + 25 }, PORTAL]) {
      let path = findPath(player, destination), steps = 0, repaths = 0;
      while (Math.hypot(player.x - destination.x, player.y - destination.y) >= .01 && steps++ < 1800) {
        // A further click can replan a route when an obstacle corner stops a step.
        if (!path.length) {
          assert.ok(++repaths <= 6, `${id}: landmark route repeatedly stopped`);
          path = findPath(player, destination);
          assert.ok(path.length, `${id}: landmark lost its reachable approach`);
        }
        followPath(player, path, 1 / 60);
        assert.ok(canStand(player.x, player.y), `${id}: movement entered a solid`);
      }
      assert.ok(Math.hypot(player.x - destination.x, player.y - destination.y) < .01,
        `${id}: could not walk to ${JSON.stringify(destination)}`);
    }
  }
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

test('new seeds vary objective positions and automatically select every authored layout', () => {
  const layouts = new Set(), placements = new Set();
  for (let seed = 0; seed < 180; seed++) {
    const expedition = createExpedition(seed);
    layouts.add(expedition.layoutId);
    placements.add(JSON.stringify(expedition.items));
  }
  assert.deepEqual([...layouts].sort(), LAYOUTS.map(({ id }) => id).sort());
  assert.ok(placements.size > 170);
  for (const { id } of LAYOUTS) {
    assert.ok(new Set(Array.from({ length: 20 }, (_, seed) => JSON.stringify(createExpedition(seed, { layoutId: id }).items))).size > 18);
  }
});

test('thirty seeds on every map support readable reachable objectives and four clear patrols', () => {
  for (const { id } of LAYOUTS) for (let seed = 0; seed < 30; seed++) {
    const expedition = createExpedition(seed, { layoutId: id, hazardCount:4 });
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
    assert.equal(expedition.hazards.length, 4, `${id}/${seed}: missing patrol`);
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
