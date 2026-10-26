import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, stepSimulation } from '../src/run-simulation.js';
import { startRun } from '../src/run-rules.js';
import { castMagic, advanceMagic, setMagicCharacter, magicStatus } from '../src/magic-rules.js';
import { DEFAULT_MECHANICS, advanceChallenge, advancedHazard } from '../src/challenge-rules.js';
import { clearSegment, clearMagicSegment } from '../src/world.js';
import { createRunTrace } from '../src/run-trace.js';
import { replayRun } from '../server/replay.js';

const disabled = Object.fromEntries(Object.keys(DEFAULT_MECHANICS).map(key => [key,false]));
const config = options => ({ seed:'magic-contract',layoutId:'crossing',rulesVersion:9,mode:'storm',enemies:[],timeLimit:150,
  mechanics:{ ...disabled,hunter:true,orderedCoins:true },...options });
function encounter() {
  const sim = createSimulation(config());
  sim.player.x = 360; sim.player.y = 368;
  const hunter = sim.challenge.terrain.hunter;
  Object.assign(hunter,{ x:360,y:200,state:'active',speed:0 });
  setMagicCharacter(sim,'wizard'); startRun(sim.run);
  assert.equal(magicStatus(sim).ready,true);
  return sim;
}

test('only an unstaggered wizard can cast at an awake hunter within range and a clear shot', () => {
  const sim = createSimulation(config());
  assert.equal(castMagic(sim),false);
  setMagicCharacter(sim,'wizard');
  assert.equal(castMagic(sim),false,'cannot cast before the attempt starts');
  startRun(sim.run);
  assert.equal(castMagic(sim),false,'sleeping hunters are not targets');
  const ready = encounter(), hunter = ready.challenge.terrain.hunter;
  ready.run.staggerRemaining = .1;
  assert.equal(castMagic(ready),false);
  ready.run.staggerRemaining = 0;
  hunter.x = 30;
  assert.equal(magicStatus(ready).label,'Too far');
  hunter.x = 200;
  assert.equal(magicStatus(ready).label,'Blocked');
  assert.equal(castMagic(ready),false);
  assert.equal(ready.magic.cooldown,0,'invalid targets do not spend the cooldown');
});

test('casting has a windup, a travelling bolt, and one second of harmless hunter stun on impact', () => {
  const sim = encounter(), hunter = sim.challenge.terrain.hunter;
  assert.equal(castMagic(sim),true);
  assert.equal(sim.magic.cooldown,3,'previously issued version-nine runs retain their cooldown');
  advanceMagic(sim,.1);
  assert.equal(sim.magic.projectile,null);
  advanceMagic(sim,.05);
  assert.ok(sim.magic.projectile);
  assert.equal(hunter.health,3,'a spell does not deal instant damage');
  let hit;
  for (let i = 0; i < 60 && !hit; i++) hit = stepSimulation(sim).find(event => event.type === 'magic-hit');
  assert.equal(hit.health,2);
  assert.equal(sim.magic.projectile,null);
  assert.equal(hunter.stunRemaining,1);
  assert.equal(sim.magic.hits,1);
  const contact = { x:hunter.x,y:hunter.y };
  assert.equal(advancedHazard(sim.challenge,contact),null);
  advanceChallenge(sim.challenge,sim.run,.9,sim.player);
  assert.equal(advancedHazard(sim.challenge,contact),null);
  advanceChallenge(sim.challenge,sim.run,.11,sim.player);
  assert.equal(advancedHazard(sim.challenge,contact).type,'hunter');
});

test('three hits defeat the hunter, stop its pursuit, and cannot be refreshed by changing character', () => {
  const sim = encounter(), hunter = sim.challenge.terrain.hunter;
  for (let shot = 1; shot <= 3; shot++) {
    assert.equal(castMagic(sim),true);
    const cooldown = sim.magic.cooldown;
    setMagicCharacter(sim,'robot'); setMagicCharacter(sim,'wizard');
    assert.equal(sim.magic.cooldown,cooldown);
    assert.equal(castMagic(sim),false);
    for (let i = 0; i < 181; i++) stepSimulation(sim);
    assert.equal(hunter.health,3 - shot);
  }
  assert.equal(hunter.state,'defeated');
  assert.equal(sim.magic.shots,3);
  assert.equal(sim.magic.hits,3);
  const position = { x:hunter.x,y:hunter.y };
  advanceChallenge(sim.challenge,sim.run,10,sim.player);
  assert.deepEqual({ x:hunter.x,y:hunter.y },position);
  assert.equal(advancedHazard(sim.challenge,position),null);
  assert.equal(castMagic(sim),false);
  const fresh = createSimulation(config());
  assert.equal(fresh.magic.cooldown,0);
  assert.equal(fresh.challenge.terrain.hunter.health,3);
});

test('projectiles fizzle on obstacles and paused or terminal attempts freeze magic timers', () => {
  const sim = encounter();
  castMagic(sim); advanceMagic(sim,.12);
  const hunter = sim.challenge.terrain.hunter;
  hunter.x = 120;
  assert.equal(clearSegment(sim.magic.projectile,hunter),false);
  assert.equal(clearMagicSegment(sim.magic.projectile,hunter),false);
  const events = advanceMagic(sim,.8);
  assert.ok(events.some(event => event.type === 'magic-blocked'));
  assert.equal(hunter.health,3);
  assert.equal(sim.magic.projectile,null);
  for (const status of ['ready','won','failed']) {
    sim.run.status = status;
    const before = structuredClone(sim.magic);
    advanceMagic(sim,3);
    assert.deepEqual(sim.magic,before);
  }
});

test('magic can fly off a narrow bridge over water while solid walls still block it', () => {
  createSimulation(config());
  const from = { x:560,y:144 }, to = { x:640,y:144 };
  assert.equal(clearSegment(from,to),false);
  assert.equal(clearMagicSegment(from,to),true);
  assert.equal(clearMagicSegment({ x:150,y:220 },{ x:270,y:220 }),false);
});

test('ranked replay reproduces real movement, character selection, spell hits and defeat after compression', () => {
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
  while (sim.challenge.terrain.hunter.state !== 'defeated' && sim.run.status === 'running' && budget-- > 0) {
    record({ magic:magicStatus(sim).ready });
  }
  assert.equal(sim.challenge.terrain.hunter.state,'defeated');
  while (sim.run.status === 'running') record();
  const packets = trace.snapshot(), result = replayRun(settings,packets);
  assert.equal(result.magicShots,3);
  assert.equal(result.magicHits,3);
  assert.equal(result.hunterDefeated,true);
  assert.equal(result.simulationSeconds,ticks / 60);
  assert.equal(result.hits,sim.run.hits);
  const expanded = packets.flatMap(([ticks,kind,x,y,actions,repath]) => Array.from({ length:ticks },(_,i) => [1,kind,x,y,i ? 0 : actions,i ? 0 : repath]));
  assert.deepEqual(replayRun(settings,expanded),result);
});

test('old tickets cannot acquire magic, contradictory character bits are invalid, and repeated inputs remain one-shot', () => {
  for (let rulesVersion = 1; rulesVersion <= 8; rulesVersion++) {
    const settings = config({ rulesVersion }), sim = createSimulation(settings);
    assert.equal(sim.magic,undefined);
    assert.equal(castMagic(sim),false);
    for (const action of [8,16,32]) assert.throws(() => replayRun(settings,[[1,0,0,0,action,0]]),/Magic characters are not enabled/);
  }
  assert.throws(() => replayRun(config(),[[1,0,0,0,48,0]]),/Invalid input packet/);
  const trace = createRunTrace();
  trace.character('robot'); trace.character('wizard'); trace.magic(); trace.step(0); trace.step(0);
  assert.deepEqual(trace.snapshot(),[[2,0,0,0,24,0]]);
});
