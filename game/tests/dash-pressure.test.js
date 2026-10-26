import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, startRun, advanceRun, activateDash, getNextDashCooldown, hitHazard } from '../src/run-rules.js';
import { createSimulation, stepSimulation } from '../src/run-simulation.js';
import { createRunTrace } from '../src/run-trace.js';
import { DEFAULT_MECHANICS } from '../src/challenge-rules.js';
import { replayRun } from '../server/replay.js';
import { createLevelDirector } from '../src/level-director.js';
import { clearSegment } from '../src/world.js';

const disabled = Object.fromEntries(Object.keys(DEFAULT_MECHANICS).map(key => [key,false]));
const config = options => ({ rulesVersion:10,mode:'storm',timeLimit:150,mechanics:{ ...disabled,dash:true },...options });

test('successive dashes recharge for 3.5, 5 and 6.5 seconds, capped thereafter and reset per attempt', () => {
  const run = createRun(config());
  assert.equal(run.dashUses,0);
  assert.equal(activateDash(run),false);
  assert.equal(run.dashUses,0);
  startRun(run);
  for (const [index,duration] of [3.5,5,6.5,6.5,6.5].entries()) {
    assert.equal(getNextDashCooldown(run),duration);
    assert.equal(activateDash(run),true);
    assert.equal(run.dashUses,index + 1);
    assert.equal(run.dashCooldown,duration);
    assert.equal(activateDash(run),false);
    assert.equal(run.dashUses,index + 1,'blocked inputs do not consume the next tier');
    advanceRun(run,duration - .01);
    assert.equal(activateDash(run),false);
    advanceRun(run,.011);
  }
  const fresh = createRun(config());
  assert.equal(fresh.dashUses,0);
  assert.equal(getNextDashCooldown(fresh),3.5);
});

test('damage interrupts a dash without refunding its use, and terminal attempts freeze recharge', () => {
  const run = createRun(config()); startRun(run); activateDash(run);
  hitHazard(run);
  assert.equal(run.dashRemaining,0);
  assert.equal(run.dashUses,1);
  assert.equal(getNextDashCooldown(run),5);
  const cooldown = run.dashCooldown;
  for (const status of ['won','failed']) {
    run.status = status; advanceRun(run,20);
    assert.equal(run.dashCooldown,cooldown);
    assert.equal(activateDash(run),false);
  }
});

test('previously issued versions three through nine retain constant recharge and no usage counter', () => {
  for (let rulesVersion = 3; rulesVersion <= 9; rulesVersion++) {
    const run = createRun(config({ rulesVersion })); startRun(run);
    for (let use = 0; use < 4; use++) {
      assert.equal(activateDash(run),true);
      assert.equal(run.dashCooldown,3.5);
      assert.equal(run.dashUses,undefined);
      advanceRun(run,3.5);
    }
  }
});

test('ranked replay preserves increasing cooldowns and one-shot actions after trace compression', () => {
  const settings = config({ seed:'dash-pressure-replay',layoutId:'crossing',enemies:[],timeLimit:30 });
  const sim = createSimulation(settings), trace = createRunTrace();
  function record(input = {}) {
    if (input.dash) trace.dash();
    trace.step(input.kind ?? 0,input.x ?? 0,input.y ?? 0);
    stepSimulation(sim,input);
  }
  record({ kind:1,x:1 });
  for (const duration of [3.5,5,6.5]) {
    record({ dash:true });
    assert.ok(Math.abs(sim.run.dashCooldown - (duration - 1 / 60)) < 1e-8);
    while (sim.run.dashCooldown > 0) record();
  }
  while (sim.run.status === 'running') record();
  const packets = trace.snapshot(), verified = replayRun(settings,packets);
  assert.equal(verified.dashUses,3);
  assert.equal(verified.dashCooldown,sim.run.dashCooldown);
  assert.equal(verified.elapsed,sim.run.elapsed);
  const expanded = packets.flatMap(([ticks,kind,x,y,actions,repath]) => Array.from({ length:ticks },(_,i) => [1,kind,x,y,i ? 0 : actions,i ? 0 : repath]));
  assert.deepEqual(replayRun(settings,expanded),verified);
});

test('level two adds four real guards with safe patrol segments and keeps them after retry', () => {
  const director = createLevelDirector({ storage:null,seed:'level-two-guard-contract' });
  const first = director.current(); director.complete(first,{ status:'won',elapsed:30,hits:0,timeLimit:first.timeLimit });
  const second = director.current(), sim = createSimulation(second);
  assert.equal(second.layoutId,'rustworks');
  assert.equal(sim.hazards.length,4);
  assert.deepEqual(sim.hazards.map(guard => guard.type),['wisp','scout','sentinel','scout']);
  for (const guard of sim.hazards) assert.ok(clearSegment(guard.from,guard.to));
  director.complete(second,{ status:'failed' });
  const retry = director.current(), retrySim = createSimulation(retry);
  assert.equal(retrySim.hazards.length,4);
  assert.equal(retrySim.run.dashUses,0);
  assert.deepEqual(retrySim.expedition.hazards,sim.expedition.hazards);
});
