import test from 'node:test';
import assert from 'node:assert/strict';
import { PORTAL } from '../src/world.js';
import { startRun } from '../src/run-rules.js';
import { createSimulation, stepSimulation } from '../src/run-simulation.js';
import { createRunTrace } from '../src/run-trace.js';
import { replayRun } from '../server/replay.js';

const DISABLED = { orderedCoins:false, pulseTraps:false, alarm:false, armor:false, exitWindow:false,
  lava:false, crumble:false, lasers:false, hunter:false, dash:false };
function config(mechanics = {}, options = {}) {
  return { seed:'simulation-contract', layoutId:'crossing', rulesVersion:2, tier:3, mode:'storm',
    enemies:[], patrolSpeed:1, timeLimit:150, shieldCharges:2, maxHits:2,
    ...options, mechanics:{ ...DISABLED, ...mechanics } };
}
function running(mechanics, options) {
  const simulation = createSimulation(config(mechanics, options));
  startRun(simulation.run);
  return simulation;
}
function place(player, destination) { player.x = destination.x; player.y = destination.y; }
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`); }

test('simulation starts only on movement and terminal attempts stop changing', () => {
  const simulation = createSimulation(config({}, { timeLimit:150 }));
  assert.deepEqual(stepSimulation(simulation, { kind:0, shield:true }), []);
  assert.equal(simulation.run.status, 'ready');
  assert.equal(simulation.run.shieldCharges, 2);
  assert.equal(simulation.challenge.clock, 0);
  stepSimulation(simulation, { kind:1, x:1 });
  assert.equal(simulation.run.status, 'running');
  close(simulation.run.elapsed, 1 / 60);
  simulation.run.elapsed = 150;
  assert.deepEqual(stepSimulation(simulation), [{ type:'failed' }]);
  const snapshot = structuredClone(simulation);
  assert.deepEqual(stepSimulation(simulation, { kind:1, x:1, shield:true }), []);
  assert.deepEqual(simulation, snapshot);
});

test('legacy configs ignore every new mechanic and disabled features restore free pickups and exit', () => {
  for (const options of [{ rulesVersion:undefined, mechanics:Object.fromEntries(Object.keys(DISABLED).map(key => [key, true])) }, {}]) {
    const simulation = createSimulation({ ...config(), ...options });
    startRun(simulation.run);
    assert.deepEqual(simulation.challenge.mechanics, DISABLED);
    assert.deepEqual(simulation.challenge.traps, []);
    assert.equal(simulation.run.maxHits, null);
    place(simulation.player, simulation.items[5]);
    assert.equal(stepSimulation(simulation)[0]?.type, 'core');
    assert.equal(simulation.items[5].collected, true);
    close(simulation.clock, 1 / 60);
    simulation.run.collected = 6;
    place(simulation.player, PORTAL);
    assert.equal(stepSimulation(simulation).at(-1)?.type, 'won');
  }
});

test('ordered coins block skipped objectives while optional coins remain collectible', () => {
  const simulation = running({ orderedCoins:true });
  place(simulation.player, simulation.items[1]);
  assert.deepEqual(stepSimulation(simulation), []);
  assert.equal(simulation.run.collected, 0);
  place(simulation.player, simulation.items[6]);
  assert.equal(stepSimulation(simulation)[0]?.type, 'bonus');
  assert.equal(simulation.run.bonuses, 1);
  for (const index of [0, 1]) {
    place(simulation.player, simulation.items[index]);
    const [event] = stepSimulation(simulation);
    assert.equal(event.type, 'core');
    assert.equal(event.item.id, index);
  }
  assert.equal(simulation.run.collected, 2);
});

test('pulse damage respects shields and lethal armor damage happens before a pickup', () => {
  const simulation = running({ pulseTraps:true, armor:true });
  const { player, run, challenge } = simulation;
  challenge.traps = [{ ...player, radius:25, period:6, phase:0, warningDuration:1, activeDuration:1 }];
  challenge.clock = 5.2;
  assert.deepEqual(stepSimulation(simulation, { shield:true }), []);
  assert.equal(run.hits, 0);
  assert.equal(run.shieldCharges, 1);
  run.shieldRemaining = 0;
  assert.equal(stepSimulation(simulation)[0]?.type, 'hit');
  assert.equal(run.hits, 1);
  run.hitCooldown = 0;
  place(simulation.items[0], player);
  assert.deepEqual(stepSimulation(simulation).map(event => event.type), ['hit','failed']);
  assert.equal(run.failureReason, 'armor');
  assert.equal(run.status, 'failed');
  assert.equal(run.collected, 0);
  assert.equal(simulation.items[0].collected, false);
});

test('disabled armor permits more hits and disabled pulse traps cannot damage the player', () => {
  const simulation = running();
  simulation.challenge.traps = [{ ...simulation.player, radius:25, period:6, phase:0, warningDuration:1, activeDuration:1 }];
  simulation.challenge.clock = 5.2;
  assert.deepEqual(stepSimulation(simulation), []);
  assert.equal(simulation.run.hits, 0);
  simulation.hazards = [{ type:'wisp', from:{ ...simulation.player }, to:{ ...simulation.player }, period:1, phase:0, radius:20 }];
  for (let index = 0; index < 4; index++) {
    simulation.run.hitCooldown = 0;
    assert.equal(stepSimulation(simulation)[0]?.type, 'hit');
  }
  assert.equal(simulation.run.hits, 4);
  assert.equal(simulation.run.status, 'running');
});

test('extraction waits for its opening and an alarm accelerates patrol time continuously', () => {
  const extraction = running({ exitWindow:true });
  extraction.run.collected = 6;
  place(extraction.player, PORTAL);
  assert.deepEqual(stepSimulation(extraction), []);
  assert.equal(extraction.run.status, 'running');
  for (let tick = 0; tick < 239; tick++) assert.deepEqual(stepSimulation(extraction), []);
  assert.equal(extraction.run.status, 'running');
  let events;
  for (let tick = 0; tick < 3 && extraction.run.status === 'running'; tick++) events = stepSimulation(extraction);
  assert.equal(extraction.run.status, 'won');
  assert.equal(events.at(-1).type, 'won');

  const alarm = running({ alarm:true });
  stepSimulation(alarm);
  const before = alarm.clock;
  alarm.run.collected = 3;
  stepSimulation(alarm);
  close(alarm.clock - before, (1 + 3 * .11) / 60);
  close(alarm.challenge.clock, 2 / 60);
});

test('a complete ordered route and extraction window produce the same browser and server result', () => {
  const configuration = config({ orderedCoins:true, exitWindow:true, alarm:true, armor:true }, { maxHits:3 });
  const simulation = createSimulation(configuration), trace = createRunTrace();
  let ticks = 0, waitingAtExit = false;
  const goals = [...simulation.items.filter(item => item.bonus), ...simulation.items.filter(item => !item.bonus), { ...PORTAL, exit:true }];
  for (const goal of goals) {
    let repath = true;
    while (goal.exit ? simulation.run.status !== 'won' : !goal.collected) {
      if (++ticks > 12000 || simulation.run.status === 'failed') throw new Error(`The controlled test route cannot finish: goal ${goal.id ?? 'exit'}, ${simulation.run.status}, ${simulation.run.collected} coins, player ${simulation.player.x},${simulation.player.y}, ${simulation.path.length} waypoints`);
      if (repath) trace.repath();
      trace.step(2, goal.x, goal.y);
      stepSimulation(simulation, { kind:2, x:goal.x, y:goal.y, repath });
      repath = !simulation.path.length && Math.hypot(simulation.player.x - goal.x, simulation.player.y - goal.y) >= 13;
      if (goal.exit && Math.hypot(simulation.player.x - goal.x, simulation.player.y - goal.y) < 15 && simulation.run.status === 'running') waitingAtExit = true;
    }
  }
  assert.equal(simulation.run.status, 'won');
  assert.equal(simulation.run.collected, 6);
  assert.equal(simulation.run.bonuses, 2);
  assert.ok(waitingAtExit, 'The route should reach a closed extraction window');
  const expected = { ...simulation.run, simulationSeconds:ticks / 60, layoutName:simulation.expedition.layoutName };
  assert.deepEqual(replayRun(configuration, trace.snapshot()), expected);
  assert.deepEqual(replayRun(configuration, trace.snapshot()), expected);
});

test('version-two tickets cannot acquire terrain hazards or dash from new mechanic flags', () => {
  const simulation = createSimulation(config({ lava:true, crumble:true, lasers:true, hunter:true, dash:true }));
  assert.deepEqual(simulation.challenge.terrain.lava, []);
  assert.deepEqual(simulation.challenge.terrain.crumbles, []);
  assert.deepEqual(simulation.challenge.terrain.lasers, []);
  assert.equal(simulation.challenge.terrain.hunter, null);
  assert.equal(simulation.run.dashEnabled, false);
});

test('dash moves at 2.3 times normal speed for both manual and path controls without refreshing cooldown', () => {
  for (const kind of [1, 2]) {
    const simulation = running({ dash:true }, { rulesVersion:3 });
    const before = { ...simulation.player };
    const input = kind === 1 ? { kind, x:1, y:0, dash:true } : { kind, x:before.x + 20, y:before.y, dash:true };
    stepSimulation(simulation, input);
    close(Math.hypot(simulation.player.x - before.x, simulation.player.y - before.y), 144 / 60 * 2.3);
    close(simulation.run.dashCooldown, 3.5 - 1 / 60);
    stepSimulation(simulation, input);
    close(simulation.run.dashCooldown, 3.5 - 2 / 60);
    assert.ok(simulation.run.dashRemaining < .18);
  }
});

test('shield prevents lava damage, dash grants no immunity, and lethal lava damage resolves before pickups', () => {
  const simulation = running({ lava:true, armor:true, dash:true }, { rulesVersion:3, maxHits:1 });
  const { terrain } = simulation.challenge;
  place(simulation.player, terrain.lava[0]);
  terrain.heat = 1.1;
  const protectedEvents = stepSimulation(simulation, { shield:true });
  assert.ok(!protectedEvents.some(event => event.type === 'hit'));
  assert.equal(simulation.run.hits, 0);
  assert.ok(terrain.heat > 1, 'Blocked damage must not reset lava heat');
  simulation.run.shieldRemaining = 0;
  const before = simulation.run.collected;
  place(simulation.items.find(item => !item.bonus && !item.collected), simulation.player);
  const events = stepSimulation(simulation, { dash:true });
  assert.deepEqual(events.map(event => event.type), ['hit','failed']);
  assert.equal(events[0].hazard.type, 'lava');
  assert.equal(simulation.run.status, 'failed');
  assert.equal(simulation.run.failureReason, 'armor');
  assert.equal(simulation.run.collected, before);
  assert.equal(terrain.heat, .35);
});

test('crumbling tiles, sweeping lasers and hunters apply lethal damage before pickups', () => {
  for (const [mechanic, type] of [['crumble','crumble'], ['lasers','laser'], ['hunter','hunter']]) {
    const simulation = running({ [mechanic]:true, armor:true }, { rulesVersion:3, maxHits:1 });
    const { player, challenge } = simulation, { terrain } = challenge;
    if (type === 'crumble') terrain.crumbles = [{ ...player, radius:22, state:'active', remaining:2.5 }];
    if (type === 'laser') {
      challenge.clock = 4.5;
      terrain.lasers = [{ x1:player.x - 20, x2:player.x + 20, centerY:player.y - Math.sin((challenge.clock + 1 / 60) * .8) * 32, y:player.y, state:'active' }];
    }
    if (type === 'hunter') terrain.hunter = { ...player, radius:14, state:'active', remaining:0, path:[], repathRemaining:0, speed:70 };
    place(simulation.items[0], player);
    const events = stepSimulation(simulation);
    assert.deepEqual(events.map(event => event.type), ['hit','failed'], mechanic);
    assert.equal(events[0].hazard.type, type);
    assert.equal(simulation.run.status, 'failed');
    assert.equal(simulation.run.collected, 0);
    assert.equal(simulation.items[0].collected, false);
  }
});
