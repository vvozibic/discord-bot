import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGE_RULES_VERSION, DEFAULT_MECHANICS, MECHANICS, mechanicsFor,
  createChallenge, advanceChallenge, advancedHazard, resolveTerrainHit } from '../src/challenge-rules.js';
import { LAYOUTS, SPAWN, PORTAL, BRIDGE, configureWorld, createExpedition,
  canStand, clearSegment, findPath } from '../src/world.js';
import { lavaContains } from '../src/terrain-hazards.js';
import { HUNTER_DASH_SPEED } from '../src/hunter-ai.js';

afterEach(() => configureWorld());

const disabled = Object.fromEntries(MECHANICS.map(({ key }) => [key, false]));
const run = (collected = 0) => ({ status:'running', collected, itemCount:6 });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function challengeFor(mechanics, options = {}) {
  const expedition = createExpedition(options.seed ?? 'terrain-contract', { layoutId:options.layoutId ?? 'crossing', hazardCount:0 });
  return createChallenge(expedition, { rulesVersion:CHALLENGE_RULES_VERSION, ...options, mechanics:{ ...disabled, ...mechanics } });
}

test('ten mechanics are independently configurable and older tickets retain their original hazards', () => {
  assert.equal(CHALLENGE_RULES_VERSION, 13);
  assert.equal(MECHANICS.length, 10);
  assert.equal(new Set(MECHANICS.map(({ key }) => key)).size, 10);
  assert.deepEqual(mechanicsFor(), disabled);
  assert.deepEqual(mechanicsFor({ rulesVersion:1, mechanics:DEFAULT_MECHANICS }), disabled);
  assert.deepEqual(mechanicsFor({ rulesVersion:2, mechanics:DEFAULT_MECHANICS }),
    Object.fromEntries(MECHANICS.map(({ key }, index) => [key, index < 5])));
  assert.deepEqual(mechanicsFor({ rulesVersion:3 }), DEFAULT_MECHANICS);
  assert.deepEqual(mechanicsFor({ rulesVersion:4 }), DEFAULT_MECHANICS);
  assert.deepEqual(mechanicsFor({ rulesVersion:5 }), DEFAULT_MECHANICS);
  assert.deepEqual(mechanicsFor({ rulesVersion:6 }), DEFAULT_MECHANICS);
  assert.deepEqual(mechanicsFor({ rulesVersion:7 }), DEFAULT_MECHANICS);
  assert.deepEqual(mechanicsFor({ rulesVersion:8 }), DEFAULT_MECHANICS);
  assert.deepEqual(mechanicsFor({ rulesVersion:9 }), DEFAULT_MECHANICS);
  assert.deepEqual(mechanicsFor({ rulesVersion:10 }), DEFAULT_MECHANICS);
  assert.deepEqual(mechanicsFor({ rulesVersion:11 }), DEFAULT_MECHANICS);
  assert.deepEqual(mechanicsFor({ rulesVersion:12 }), DEFAULT_MECHANICS);
  assert.deepEqual(mechanicsFor({ rulesVersion:3, mechanics:disabled }), disabled);
  for (const { key } of MECHANICS) {
    assert.equal(mechanicsFor({ rulesVersion:3, mechanics:{ [key]:false } })[key], false);
  }
});

test('disabled terrain has no active state, collision or accumulating heat', () => {
  const challenge = challengeFor({});
  const player = { ...SPAWN };
  advanceChallenge(challenge, run(6), 30, player);
  assert.deepEqual(challenge.terrain, { lava:[], heat:0, crumbles:[], lasers:[], hunter:null });
  assert.equal(advancedHazard(challenge, player), null);
  const legacy = createChallenge(createExpedition('legacy'), { rulesVersion:2, mechanics:DEFAULT_MECHANICS });
  advanceChallenge(legacy, run(6), 30, { ...SPAWN });
  assert.deepEqual(legacy.terrain, { lava:[], heat:0, crumbles:[], lasers:[], hunter:null });
});

test('seeded terrain repeats and crumble sites are safe and reachable on every map', () => {
  for (const { id } of LAYOUTS) for (let seed = 0; seed < 12; seed++) {
    const options = { seed, layoutId:id };
    const first = challengeFor(DEFAULT_MECHANICS, options);
    assert.deepEqual(challengeFor(DEFAULT_MECHANICS, options), first);
    assert.equal(first.terrain.lava.length, 3);
    assert.equal(first.terrain.crumbles.length, 2, `${id}/${seed}`);
    assert.equal(first.terrain.lasers.length, 1);
    assert.equal(first.terrain.lasers[0].x1, BRIDGE.x - 8);
    assert.equal(first.terrain.lasers[0].x2, BRIDGE.x + BRIDGE.width + 8);
    for (const area of first.terrain.crumbles) {
      assert.ok(canStand(area.x, area.y));
      assert.ok(findPath(SPAWN, area).length);
      assert.ok(Math.hypot(area.x - SPAWN.x, area.y - SPAWN.y) > area.radius + 36);
      assert.ok(Math.hypot(area.x - PORTAL.x, area.y - PORTAL.y) > area.radius + 36);
    }
    advanceChallenge(first, run(), 1 / 60, { ...SPAWN });
    assert.equal(advancedHazard(first, SPAWN), null, 'Starting area must be safe');
    assert.equal(first.terrain.heat, 0);
  }
});

test('heated ground gives crossing grace, cools rapidly outside and resets after a hit', () => {
  const challenge = challengeFor({ lava:true }), player = { ...challenge.terrain.lava[0] };
  advanceChallenge(challenge, run(), .45, player);
  close(challenge.terrain.heat, .9);
  assert.equal(advancedHazard(challenge, player), null);
  advanceChallenge(challenge, run(), .05, player);
  const hazard = advancedHazard(challenge, player);
  assert.equal(hazard.type, 'lava');
  resolveTerrainHit(challenge, hazard);
  close(challenge.terrain.heat, .35);
  assert.equal(advancedHazard(challenge, player), null);
  challenge.terrain.heat = 1.4;
  const edge = challenge.terrain.lava[0];
  const outside = { x:edge.x + edge.radius + 6, y:edge.y + edge.radius + 6 };
  assert.equal(advancedHazard(challenge, outside), null, 'Beyond the square boundary is safe');
  advanceChallenge(challenge, run(), .5, outside);
  close(challenge.terrain.heat, .85);
  advanceChallenge(challenge, run(), 1, outside);
  assert.equal(challenge.terrain.heat, 0);
});

test('older issued attempts keep their original heat buildup', () => {
  for (const [rulesVersion, duration] of [[3,1.3],[4,1.3],[5,1.3],[6,.65],[7,.5]]) {
    const challenge = challengeFor({ lava:true }, { rulesVersion });
    const player = { ...challenge.terrain.lava[0] };
    advanceChallenge(challenge, run(), duration / 2, player);
    close(challenge.terrain.heat, .5);
    assert.equal(advancedHazard(challenge, player), null);
    advanceChallenge(challenge, run(), duration / 2, player);
    assert.equal(advancedHazard(challenge, player).type, 'lava');
  }
});

test('square lava heats and damages at its corners and edges, while old tickets keep circular patches', () => {
  const challenge = challengeFor({ lava:true }), area = challenge.terrain.lava[0];
  assert.equal(area.shape,'square');
  const corner = { x:area.x + area.radius, y:area.y + area.radius };
  advanceChallenge(challenge,run(),.5,corner);
  assert.equal(advancedHazard(challenge,corner).type,'lava');
  assert.equal(lavaContains({ x:area.x + area.radius + 5,y:area.y },area),true);
  assert.equal(lavaContains({ x:area.x + area.radius + 5.01,y:area.y },area),false);
  for (const rulesVersion of [3,4,5,6,7]) {
    const old = challengeFor({ lava:true },{ rulesVersion }), legacyArea = old.terrain.lava[0];
    assert.equal(legacyArea.shape,undefined);
    const legacyCorner = { x:legacyArea.x + legacyArea.radius,y:legacyArea.y + legacyArea.radius };
    advanceChallenge(old,run(),1.3,legacyCorner);
    assert.equal(old.terrain.heat,0);
    assert.equal(advancedHazard(old,legacyCorner),null);
  }
});

test('faster heat reaches damage at the same time across frame rates and stops on pause', () => {
  for (const fps of [30,60,120]) {
    const challenge = challengeFor({ lava:true });
    const player = { ...challenge.terrain.lava[0] };
    const ticks = Math.ceil(.5 * fps);
    for (let tick = 0; tick < ticks - 1; tick++) advanceChallenge(challenge, run(), 1 / fps, player);
    assert.equal(advancedHazard(challenge, player), null);
    const beforePause = challenge.terrain.heat;
    advanceChallenge(challenge, { ...run(), status:'ready' }, 1, player);
    close(challenge.terrain.heat, beforePause);
    advanceChallenge(challenge, run(), 1 / fps, player);
    assert.equal(advancedHazard(challenge, player).type, 'lava');
  }
});

test('crumble tiles warn for one second, collapse for 2.5 seconds and reset', () => {
  const challenge = challengeFor({ crumble:true }), area = challenge.terrain.crumbles[0];
  const player = { x:area.x, y:area.y };
  advanceChallenge(challenge, run(), .5, player);
  assert.equal(area.state, 'warning');
  close(area.remaining, .5);
  assert.equal(advancedHazard(challenge, player), null);
  advanceChallenge(challenge, run(), .49, player);
  assert.equal(area.state, 'warning');
  advanceChallenge(challenge, run(), .01, player);
  assert.equal(area.state, 'active');
  close(area.remaining, 2.5);
  assert.equal(advancedHazard(challenge, player).type, 'crumble');
  assert.equal(advancedHazard(challenge, { x:area.x + 25, y:area.y + 25 }), null);
  advanceChallenge(challenge, run(), 2.49, { ...SPAWN });
  assert.equal(area.state, 'active', 'Leaving the tile must not cancel its collapse');
  advanceChallenge(challenge, run(), .01, { ...SPAWN });
  assert.equal(area.state, 'idle');
  assert.equal(area.remaining, 0);
  advanceChallenge(challenge, run(), .05, player);
  assert.equal(area.state, 'warning', 'A reset tile must provide a new warning');
});

test('laser sweep has clear idle and warning windows and only its finite segment damages', () => {
  const challenge = challengeFor({ lasers:true }), beam = challenge.terrain.lasers[0];
  advanceChallenge(challenge, run(), 2.99, { ...SPAWN });
  assert.equal(beam.state, 'idle');
  advanceChallenge(challenge, run(), .11, { ...SPAWN });
  assert.equal(beam.state, 'warning');
  assert.equal(advancedHazard(challenge, { x:beam.x1, y:beam.y }), null);
  advanceChallenge(challenge, run(), 1, { ...SPAWN });
  assert.equal(beam.state, 'active');
  close(beam.y, beam.centerY + Math.sin(challenge.clock * .8) * 32);
  assert.equal(advancedHazard(challenge, { x:(beam.x1 + beam.x2) / 2, y:beam.y }).type, 'laser');
  assert.equal(advancedHazard(challenge, { x:beam.x2 + 4, y:beam.y }).type, 'laser');
  assert.equal(advancedHazard(challenge, { x:beam.x2 + 6, y:beam.y }), null);
  assert.equal(advancedHazard(challenge, { x:beam.x2 + 4, y:beam.y + 4 }), null);
  assert.equal(advancedHazard(challenge, { x:beam.x1, y:beam.y + 6 }), null);
  advanceChallenge(challenge, run(), 1.2, { ...SPAWN });
  assert.equal(beam.state, 'idle');
});

test('hunter wakes on the third core with a 1.5-second warning and never teleports', () => {
  const challenge = challengeFor({ hunter:true }, { tier:5 }), hunter = challenge.terrain.hunter;
  const origin = { x:hunter.x, y:hunter.y }, player = { ...SPAWN };
  assert.equal(hunter.speed, 95);
  advanceChallenge(challenge, run(2), 20, player);
  assert.equal(hunter.state, 'sleeping');
  advanceChallenge(challenge, run(3), .01, player);
  assert.equal(hunter.state, 'warning');
  close(hunter.remaining, 1.5);
  advanceChallenge(challenge, run(3), 1.4, player);
  assert.equal(hunter.state, 'warning');
  assert.deepEqual({ x:hunter.x, y:hunter.y }, origin);
  advanceChallenge(challenge, run(3), .1, player);
  assert.equal(hunter.state, 'active');
  assert.deepEqual({ x:hunter.x, y:hunter.y }, origin);
  advanceChallenge(challenge, run(3), .02, player);
  assert.ok(Math.hypot(hunter.x - origin.x, hunter.y - origin.y) <= hunter.speed * .02 + 1e-8);
});

test('hunter paths around water and walls using continuous collision-respecting steps', () => {
  const challenge = challengeFor({ hunter:true }), hunter = challenge.terrain.hunter;
  Object.assign(hunter, { x:440, y:144, state:'active' });
  const player = { x:704, y:144 };
  assert.ok(canStand(hunter.x, hunter.y));
  assert.ok(canStand(player.x, player.y));
  assert.equal(clearSegment(hunter, player), false);
  let reached = false;
  for (let index = 0; index < 1200; index++) {
    const previous = { x:hunter.x, y:hunter.y };
    advanceChallenge(challenge, run(3), 1 / 60, player);
    assert.ok(canStand(hunter.x, hunter.y));
    assert.ok(clearSegment(previous, hunter), 'Hunter crossed an obstacle');
    assert.ok(Math.hypot(hunter.x - previous.x, hunter.y - previous.y) <= (hunter.smart ? HUNTER_DASH_SPEED : hunter.speed) / 60 + 1e-8);
    if (advancedHazard(challenge, player)?.type === 'hunter') { reached = true; break; }
  }
  assert.ok(reached, 'Hunter must eventually reach a stationary player around the pond');
});

test('terrain only advances during a running attempt and deterministic inputs reproduce its state', () => {
  const first = challengeFor(DEFAULT_MECHANICS), second = challengeFor(DEFAULT_MECHANICS);
  const snapshot = structuredClone(first), player = { ...SPAWN };
  for (const status of ['ready', 'won', 'failed']) advanceChallenge(first, { ...run(3), status }, 3, player);
  for (const dt of [0, -1, NaN, Infinity]) advanceChallenge(first, run(3), dt, player);
  assert.deepEqual(first, snapshot);
  for (let index = 0; index < 360; index++) {
    advanceChallenge(first, run(3), 1 / 60, player);
    advanceChallenge(second, run(3), 1 / 60, player);
  }
  assert.deepEqual(first, second);
});
