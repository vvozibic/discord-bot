import test from 'node:test';
import assert from 'node:assert/strict';
import { canStand, configureWorld } from '../src/world.js';
import { activateDash, startRun } from '../src/run-rules.js';
import { createSimulation, stepSimulation } from '../src/run-simulation.js';
import { IMPACT_DURATION, IMPACT_SPEED, createImpact, advanceImpact, impactDirection } from '../src/damage-response.js';
import { createRunTrace } from '../src/run-trace.js';
import { replayRun } from '../server/replay.js';

const DISABLED = { orderedCoins:false, pulseTraps:false, alarm:false, armor:false, exitWindow:false,
  lava:false, crumble:false, lasers:false, hunter:false, dash:false };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);
function config(mechanics = {}, options = {}) {
  return { seed:'damage-response-contract', layoutId:'crossing', rulesVersion:4, tier:0, mode:'storm',
    enemies:[], patrolSpeed:1, timeLimit:150, shieldCharges:2, maxHits:4,
    ...options, mechanics:{ ...DISABLED, ...mechanics } };
}
function running(mechanics, options) {
  const simulation = createSimulation(config(mechanics, options));
  startRun(simulation.run);
  return simulation;
}
function contact(simulation, dx = -6, dy = 0) {
  const point = { x:simulation.player.x + dx, y:simulation.player.y + dy };
  simulation.hazards = [{ type:'sentinel', from:point, to:point, period:1, phase:0, radius:50 }];
}

test('impact normals use actual contact geometry, active pulses and deterministic exact-overlap fallback', () => {
  const player = { x:100, y:100, facing:'right' };
  assert.deepEqual(impactDirection(player, { type:'hunter', x:94, y:92 }), { x:.6, y:.8 });
  assert.deepEqual(impactDirection(player, { type:'laser', x1:70, x2:130, y:98 }), { x:0, y:1 });
  assert.deepEqual(impactDirection(player, { type:'laser', x1:70, x2:130, y:100 }), { x:-1, y:0 });
  assert.deepEqual(impactDirection(player, { type:'lava', x:100, y:100 }), { x:-1, y:0 });
  const active = (x, y) => ({ x, y, radius:25, period:6, phase:0, activeDuration:1, warningDuration:1 });
  const challenge = { clock:5.5, traps:[{ ...active(100, 99), phase:2 }, active(100, 110), active(97, 100)] };
  assert.deepEqual(impactDirection(player, { type:'trap' }, challenge), { x:1, y:0 });
  assert.deepEqual(impactDirection({ x:100, y:100 }, { type:'trap' }, { clock:0, traps:[] }), { x:0, y:-1 });
});

test('unshielded contact produces a decaying physical recoil and a short input stagger', () => {
  const simulation = running();
  contact(simulation);
  const origin = { ...simulation.player };
  const [hit] = stepSimulation(simulation);
  assert.equal(hit.type, 'hit');
  assert.deepEqual(hit.impact, { x:1, y:0 });
  assert.equal(simulation.impact.sourceType, 'sentinel');
  close(simulation.impact.remaining, IMPACT_DURATION);
  close(simulation.run.staggerRemaining, .18);
  const displacements = [];
  let beforeX = simulation.player.x;
  for (let tick = 0; tick < 14; tick++) {
    stepSimulation(simulation);
    displacements.push(simulation.player.x - beforeX);
    beforeX = simulation.player.x;
  }
  close(simulation.player.x - origin.x, IMPACT_SPEED * IMPACT_DURATION / 2);
  close(simulation.player.y, origin.y);
  assert.ok(displacements[0] > displacements[1] && displacements[1] > displacements[2]);
  assert.equal(simulation.player.facing, origin.facing, 'Recoil must not reverse the hero facing');
  assert.equal(simulation.run.staggerRemaining, 0);
  const recoveredX = simulation.player.x;
  stepSimulation(simulation, { kind:1, x:-1 });
  close(simulation.player.x, recoveredX - 144 / 60);

  const staggered = running();
  contact(staggered);
  stepSimulation(staggered);
  const staggerX = staggered.player.x;
  stepSimulation(staggered, { kind:1, x:-1 });
  assert.ok(staggered.player.x > staggerX, 'Opposing movement is briefly interrupted by the impact');
  assert.equal(staggered.player.walking, false);
});

test('recoil cannot cross a hut wall, a narrow log, or the water edge during catch-up', () => {
  configureWorld('crossing');
  for (const { player, hazard, allowed } of [
    { player:{ x:258, y:230, facing:'left' }, hazard:{ x:264, y:230 }, allowed:p => p.x >= 257 },
    { player:{ x:459, y:150, facing:'right' }, hazard:{ x:453, y:150 }, allowed:p => p.x <= 459 },
    { player:{ x:280, y:171, facing:'down' }, hazard:{ x:280, y:165 }, allowed:p => p.y <= 173 },
  ]) {
    assert.ok(canStand(player.x, player.y));
    const simulation = { player, impact:createImpact(player, { type:'sentinel', ...hazard }) };
    advanceImpact(simulation, 1);
    assert.ok(canStand(player.x, player.y));
    assert.ok(allowed(player), `Recoil crossed an obstacle at ${player.x},${player.y}`);
    assert.equal(simulation.impact.remaining, 0);
  }
});

test('shields and the existing damage grace do not generate repeated recoil or stagger', () => {
  const simulation = running();
  contact(simulation);
  assert.deepEqual(stepSimulation(simulation, { shield:true }), []);
  assert.equal(simulation.impact, null);
  assert.equal(simulation.run.staggerRemaining, 0);
  assert.equal(simulation.run.hits, 0);
  simulation.run.shieldRemaining = 0;
  assert.equal(stepSimulation(simulation)[0]?.type, 'hit');
  const impact = simulation.impact;
  for (let tick = 0; tick < 30; tick++) assert.ok(!stepSimulation(simulation).some(event => event.type === 'hit'));
  assert.equal(simulation.impact, impact);
  assert.equal(simulation.run.hits, 1);
  assert.equal(simulation.impact.remaining, 0);
  assert.equal(simulation.run.staggerRemaining, 0);
  assert.ok(simulation.run.hitCooldown > 1.4);
});

test('damage interrupts dash and path movement; a new click resumes once stagger ends', () => {
  const simulation = running({ dash:true });
  contact(simulation);
  assert.equal(activateDash(simulation.run), true);
  const target = { x:simulation.player.x + 40, y:simulation.player.y };
  const [event] = stepSimulation(simulation, { kind:2, ...target, repath:true });
  assert.equal(event.type, 'hit');
  assert.equal(simulation.run.dashRemaining, 0);
  assert.deepEqual(simulation.path, []);
  assert.equal(simulation.target, null);
  simulation.run.dashCooldown = 0;
  assert.equal(activateDash(simulation.run), false);
  for (let tick = 0; tick < 15; tick++) stepSimulation(simulation, { kind:2, ...target });
  assert.deepEqual(simulation.path, [], 'A pre-hit path input cannot silently resume');
  assert.equal(simulation.run.staggerRemaining, 0);
  assert.equal(activateDash(simulation.run), true);
  stepSimulation(simulation, { kind:2, ...target, repath:true });
  assert.equal(simulation.awaitingRepath, false);
  assert.equal(simulation.player.walking, true);
});

test('lethal contact still emits its direction, stops before pickups and freezes simulation', () => {
  const simulation = running({ armor:true }, { maxHits:1 });
  contact(simulation);
  Object.assign(simulation.items[0], { x:simulation.player.x, y:simulation.player.y });
  const events = stepSimulation(simulation, { kind:2, x:simulation.player.x + 40, y:simulation.player.y, repath:true });
  assert.deepEqual(events.map(event => event.type), ['hit','failed']);
  close(Math.hypot(events[0].impact.x, events[0].impact.y), 1);
  assert.ok(events[0].impact.x > 0, 'The lethal hit must still point away from the contact');
  assert.equal(simulation.run.collected, 0);
  assert.equal(simulation.items[0].collected, false);
  assert.deepEqual(simulation.path, []);
  const terminal = structuredClone(simulation);
  assert.deepEqual(stepSimulation(simulation, { kind:1, x:1, dash:true }), []);
  assert.deepEqual(simulation, terminal);
});

test('version one through three retain their original movement and hit event behavior', () => {
  for (const rulesVersion of [undefined, 1, 2, 3]) {
    const simulation = running({}, { rulesVersion });
    contact(simulation);
    const [event] = stepSimulation(simulation);
    assert.deepEqual(Object.keys(event).sort(), ['hazard','type']);
    assert.equal(simulation.run.damageResponseEnabled, undefined);
    assert.equal(simulation.run.staggerRemaining, undefined);
    assert.equal(simulation.impact, undefined);
    const before = { ...simulation.player };
    stepSimulation(simulation, { kind:1, x:1 });
    close(simulation.player.x - before.x, 144 / 60);
    close(simulation.player.y, before.y);
  }
});

test('a version-four trace with real lava recoil produces the same server replay result', () => {
  const configuration = config({ lava:true }, { timeLimit:30 });
  const simulation = createSimulation(configuration), trace = createRunTrace();
  const target = { ...simulation.challenge.terrain.lava[0] };
  let ticks = 0;
  while (simulation.run.status !== 'failed' && ticks < 3000) {
    const approach = simulation.run.hits === 0;
    const input = approach ? { kind:2, x:target.x, y:target.y, repath:ticks === 0 } : { kind:0, x:0, y:0 };
    if (input.repath) trace.repath();
    trace.step(input.kind, input.x, input.y);
    stepSimulation(simulation, input);
    ticks++;
  }
  assert.ok(simulation.run.hits > 0, 'The route must exercise actual physical damage');
  assert.equal(simulation.run.status, 'failed');
  const expected = { ...simulation.run, simulationSeconds:ticks / 60, layoutName:simulation.expedition.layoutName };
  assert.deepEqual(replayRun(configuration, trace.snapshot()), expected);
  assert.deepEqual(replayRun(configuration, trace.snapshot()), expected);
});
