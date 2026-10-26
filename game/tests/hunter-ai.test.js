import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, stepSimulation } from '../src/run-simulation.js';
import { startRun } from '../src/run-rules.js';
import { DEFAULT_MECHANICS, advanceChallenge } from '../src/challenge-rules.js';
import { HUNTER_DASH_WARNING, HUNTER_DASH_SPEED, HUNTER_DASH_DURATION } from '../src/hunter-ai.js';
import { castMagic, setMagicCharacter, magicStatus, MAGIC_COOLDOWN } from '../src/magic-rules.js';
import { clearSegment, canStand } from '../src/world.js';
import { createRunTrace } from '../src/run-trace.js';
import { replayRun } from '../server/replay.js';

const disabled = Object.fromEntries(Object.keys(DEFAULT_MECHANICS).map(key => [key,false]));
const config = options => ({ seed:'smarter-hunter-contract',layoutId:'crossing',rulesVersion:11,mode:'storm',enemies:[],timeLimit:150,
  mechanics:{ ...disabled,hunter:true,orderedCoins:true },...options });
function encounter() {
  const sim = createSimulation(config()); startRun(sim.run);
  Object.assign(sim.player,{ x:360,y:200 });
  Object.assign(sim.challenge.terrain.hunter,{ x:360,y:368,state:'active',dashCooldown:0 });
  return sim;
}

test('hunter predicts a moving player and replans toward a reachable point ahead', () => {
  const sim = encounter(), hunter = sim.challenge.terrain.hunter;
  hunter.dashCooldown = 99;
  for (let tick = 0; tick < 24; tick++) {
    sim.player.x += 1;
    advanceChallenge(sim.challenge,sim.run,1 / 60,sim.player);
  }
  assert.ok(hunter.velocity.x > 50);
  assert.ok(hunter.target.x > sim.player.x + 10,'cuts toward the route ahead instead of the previous position');
  assert.equal(hunter.intercepting,true);
  assert.ok(canStand(hunter.target.x,hunter.target.y));
  assert.ok(clearSegment(sim.player,hunter.target));
});

test('dash warns without moving, commits its direction, travels continuously and then recovers', () => {
  const sim = encounter(), hunter = sim.challenge.terrain.hunter;
  advanceChallenge(sim.challenge,sim.run,1 / 60,sim.player);
  assert.equal(hunter.dashPhase,'windup');
  assert.ok(hunter.dashWarning <= HUNTER_DASH_WARNING && hunter.dashWarning > .5);
  const origin = { x:hunter.x,y:hunter.y }, target = { ...hunter.dashTarget };
  sim.player.x = 400;
  let ticks = 0;
  while (hunter.dashPhase === 'windup' && ticks++ < 80) {
    advanceChallenge(sim.challenge,sim.run,1 / 60,sim.player);
    assert.deepEqual(hunter.dashTarget,target,'warning line must not track a sidestepping player');
    if (hunter.dashPhase === 'windup') assert.deepEqual({ x:hunter.x,y:hunter.y },origin);
    else assert.ok(Math.hypot(hunter.x - origin.x,hunter.y - origin.y) <= HUNTER_DASH_SPEED / 60 + 1e-8);
  }
  assert.equal(hunter.dashPhase,'charge');
  let fastest = 0;
  while (hunter.dashPhase === 'charge' && ticks++ < 160) {
    const before = { x:hunter.x,y:hunter.y };
    advanceChallenge(sim.challenge,sim.run,1 / 60,sim.player);
    const distance = Math.hypot(hunter.x - before.x,hunter.y - before.y);
    fastest = Math.max(fastest,distance * 60);
    assert.ok(distance <= HUNTER_DASH_SPEED / 60 + 1e-8);
    assert.ok(clearSegment(before,hunter));
  }
  assert.ok(fastest > hunter.speed * 2);
  assert.ok(Math.hypot(hunter.x - origin.x,hunter.y - origin.y) <= HUNTER_DASH_SPEED * HUNTER_DASH_DURATION + 1e-8);
  assert.equal(hunter.dashes,1);
  assert.equal(hunter.dashPhase,'recover');
  const recovering = { x:hunter.x,y:hunter.y };
  advanceChallenge(sim.challenge,sim.run,.2,sim.player);
  assert.deepEqual({ x:hunter.x,y:hunter.y },recovering);
  assert.ok(hunter.dashCooldown > 4);
});

test('hunter cannot dash through water or walls and still navigates toward the player', () => {
  const sim = encounter(), hunter = sim.challenge.terrain.hunter;
  Object.assign(hunter,{ x:440,y:144 }); Object.assign(sim.player,{ x:704,y:144 });
  assert.equal(clearSegment(hunter,sim.player),false);
  for (let tick = 0; tick < 20; tick++) {
    const before = { x:hunter.x,y:hunter.y };
    advanceChallenge(sim.challenge,sim.run,1 / 60,sim.player);
    assert.notEqual(hunter.dashPhase,'charge');
    assert.ok(clearSegment(before,hunter));
  }
  assert.ok(hunter.path.length || hunter.dashPhase === 'windup');
  if (hunter.dashTarget) assert.ok(clearSegment(hunter,hunter.dashTarget));
});

test('magic interrupts both dash preparation and an active charge with a real projectile hit', () => {
  for (const phase of ['windup','charge']) {
    const sim = encounter(), hunter = sim.challenge.terrain.hunter;
    setMagicCharacter(sim,'wizard');
    advanceChallenge(sim.challenge,sim.run,1 / 60,sim.player);
    if (phase === 'charge') for (let tick = 0; tick < 80 && hunter.dashPhase !== 'charge'; tick++) advanceChallenge(sim.challenge,sim.run,1 / 60,sim.player);
    assert.equal(hunter.dashPhase,phase);
    assert.equal(castMagic(sim),true);
    let hit;
    for (let tick = 0; tick < 100 && !hit; tick++) hit = stepSimulation(sim).find(event => event.type === 'magic-hit');
    assert.ok(hit);
    assert.equal(hunter.health,2);
    assert.equal(hunter.dashPhase,'ready');
    assert.ok(hunter.stunRemaining > 0);
    assert.ok(hunter.dashCooldown >= 2);
    const stopped = { x:hunter.x,y:hunter.y };
    advanceChallenge(sim.challenge,sim.run,.5,sim.player);
    assert.deepEqual({ x:hunter.x,y:hunter.y },stopped);
  }
});

test('magic cooldown drops to two seconds in new runs while older attempts keep three seconds and the original hunter', () => {
  assert.equal(MAGIC_COOLDOWN,2);
  for (const rulesVersion of [9,10,11]) {
    const sim = createSimulation(config({ rulesVersion }));
    Object.assign(sim.player,{ x:360,y:200 });
    Object.assign(sim.challenge.terrain.hunter,{ x:360,y:368,state:'active' });
    startRun(sim.run); setMagicCharacter(sim,'wizard');
    assert.equal(castMagic(sim),true);
    assert.equal(sim.magic.cooldown,rulesVersion >= 11 ? 2 : 3);
    assert.equal(Boolean(sim.challenge.terrain.hunter.smart),rulesVersion >= 11);
    const fresh = createSimulation(config({ rulesVersion }));
    assert.equal(fresh.magic.cooldown,0);
    if (rulesVersion >= 11) assert.equal(fresh.challenge.terrain.hunter.dashes,0);
  }
});

test('paused and terminal simulations freeze hunter dash timers and magic recharge', () => {
  const sim = encounter(); setMagicCharacter(sim,'wizard');
  castMagic(sim); advanceChallenge(sim.challenge,sim.run,1 / 60,sim.player);
  for (const status of ['ready','won','failed']) {
    sim.run.status = status;
    const hunter = structuredClone(sim.challenge.terrain.hunter), magic = structuredClone(sim.magic);
    advanceChallenge(sim.challenge,sim.run,5,sim.player);
    if (status !== 'ready') stepSimulation(sim);
    assert.deepEqual(sim.challenge.terrain.hunter,hunter);
    assert.deepEqual(sim.magic,magic);
  }
});

test('ranked replay reproduces predictive pursuit, faster attacks and magic interruptions from real movement', () => {
  const settings = config(), sim = createSimulation(settings), trace = createRunTrace();
  let ticks = 0;
  function record(input = {}) {
    if (input.character) trace.character(input.character);
    if (input.magic) trace.magic();
    if (input.repath) trace.repath();
    trace.step(input.kind ?? 0,input.x ?? 0,input.y ?? 0);
    stepSimulation(sim,input); ticks++;
  }
  record({ character:'wizard' });
  for (const item of sim.items.filter(item => !item.bonus).slice(0,3)) {
    let budget = 1500;
    while (!item.collected && budget-- > 0) record({ kind:2,x:item.x,y:item.y,repath:!sim.path.length });
    assert.equal(item.collected,true);
  }
  let budget = 1500;
  while (sim.challenge.terrain.hunter.state !== 'defeated' && sim.run.status === 'running' && budget-- > 0) record({ magic:magicStatus(sim).ready });
  assert.equal(sim.challenge.terrain.hunter.state,'defeated');
  while (sim.run.status === 'running') record();
  const packets = trace.snapshot(), result = replayRun(settings,packets);
  assert.equal(result.magicHits,3);
  assert.equal(result.hunterDefeated,true);
  assert.equal(result.hits,sim.run.hits);
  assert.equal(result.simulationSeconds,ticks / 60);
  const expanded = packets.flatMap(([count,kind,x,y,actions,repath]) => Array.from({ length:count },(_,i) => [1,kind,x,y,i ? 0 : actions,i ? 0 : repath]));
  assert.deepEqual(replayRun(settings,expanded),result);
});
