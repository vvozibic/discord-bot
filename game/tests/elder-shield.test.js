import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, startRun, advanceRun, claimElderShield, activateShield, hitHazard } from '../src/run-rules.js';
import { createSimulation, stepSimulation } from '../src/run-simulation.js';
import { createRunTrace } from '../src/run-trace.js';
import { DEFAULT_MECHANICS } from '../src/challenge-rules.js';
import { GUARDIAN, LAYOUTS, findPath } from '../src/world.js';
import { replayRun } from '../server/replay.js';

const config = layoutId => ({ seed:`elder-contract-${layoutId}`, layoutId, rulesVersion:5, mode:'storm',
  enemies:[], timeLimit:30, shieldCharges:99,
  mechanics:Object.fromEntries(Object.keys(DEFAULT_MECHANICS).map(key => [key, false])) });

test('every map starts empty and awards one shield only within talking distance of its elder', () => {
  for (const { id } of LAYOUTS) {
    const sim = createSimulation(config(id));
    assert.equal(sim.run.shieldCharges, 0, 'configured capacity cannot create starting shields');
    assert.equal(sim.run.elderGiftClaimed, false);
    assert.equal(claimElderShield(sim.run, sim.player), false);
    assert.ok(findPath(sim.player, { x:GUARDIAN.x, y:GUARDIAN.y + 25 }).length, `${id}: reachable elder`);
    for (const player of [{ x:GUARDIAN.x + 46, y:GUARDIAN.y }, { x:NaN, y:GUARDIAN.y }, {}]) {
      assert.equal(claimElderShield(sim.run, player), false);
    }
    assert.equal(claimElderShield(sim.run, { x:GUARDIAN.x, y:GUARDIAN.y + 25 }), true);
    assert.equal(sim.run.shieldCharges, 1);
    assert.equal(sim.run.elderGiftClaimed, true);
  }
});

test('the elder never refills a charge, the ward lasts three seconds, and a new attempt resets the unlock', () => {
  const { run } = createSimulation(config('crossing'));
  const nearby = { x:GUARDIAN.x, y:GUARDIAN.y + 25 };
  startRun(run);
  assert.equal(activateShield(run), false);
  assert.equal(claimElderShield(run, nearby), true);
  assert.equal(claimElderShield(run, nearby), false);
  assert.equal(activateShield(run), true);
  assert.equal(run.shieldCharges, 0);
  assert.equal(run.shieldRemaining, 3);
  assert.equal(hitHazard(run), false);
  advanceRun(run, 2.99);
  assert.equal(hitHazard(run), false);
  advanceRun(run, .02);
  assert.equal(run.shieldRemaining, 0);
  assert.equal(claimElderShield(run, nearby), false);
  assert.equal(activateShield(run), false);
  assert.equal(hitHazard(run), true);
  const fresh = createRun(config('crossing'));
  assert.equal(fresh.shieldCharges, 0);
  assert.equal(fresh.elderGiftClaimed, false);
  assert.equal(claimElderShield({ ...fresh, status:'failed' }, nearby), false);
  assert.equal(claimElderShield({ ...fresh, status:'won' }, nearby), false);
});

test('ranked replay derives the one-time elder gift from a real route and preserves compressed actions', () => {
  const settings = config('crossing'), sim = createSimulation(settings), trace = createRunTrace();
  const destination = { x:GUARDIAN.x, y:GUARDIAN.y + 25 };
  const record = input => {
    if (input.elder) trace.elder();
    if (input.shield) trace.shield();
    if (input.repath) trace.repath();
    trace.step(input.kind ?? 0, input.x ?? 0, input.y ?? 0);
    stepSimulation(sim, input);
  };
  let ticks = 0;
  while (Math.hypot(sim.player.x - GUARDIAN.x, sim.player.y - GUARDIAN.y) > 44) {
    record({ kind:2, ...destination, repath:ticks === 0 });
    assert.ok(++ticks < 1000);
  }
  record({ elder:true, shield:true });
  assert.equal(sim.run.elderGiftClaimed, true);
  assert.equal(sim.run.shieldCharges, 0);
  assert.ok(sim.run.shieldRemaining > 2.9);
  for (let i = 0; i < 200; i++) record({});
  record({ elder:true, shield:true });
  assert.equal(sim.run.shieldRemaining, 0, 'repeated conversations cannot reactivate a consumed ward');
  while (sim.run.status !== 'failed') record({});
  const packets = trace.snapshot(), result = replayRun(settings, packets);
  assert.equal(result.elderGiftClaimed, true);
  assert.equal(result.shieldCharges, 0);
  assert.equal(result.hits, 0);
  assert.equal(result.status, 'failed');
  const expanded = packets.flatMap(([ticks, kind, x, y, actions, repath]) => Array.from({ length:ticks }, (_, i) => [1, kind, x, y, i ? 0 : actions, i ? 0 : repath]));
  assert.deepEqual(replayRun(settings, expanded), result);
  const withoutConversation = packets.map(packet => packet.map((value, index) => index === 4 ? value & ~4 : value));
  const unclaimed = replayRun(settings, withoutConversation);
  assert.equal(unclaimed.elderGiftClaimed, false);
  assert.equal(unclaimed.shieldCharges, 0);
});

test('ranked replay ignores remote elder claims and old tickets keep their original shields', () => {
  const settings = config('crossing');
  const result = replayRun(settings, [[1,1,1,0,5,0], [1800,0,0,0,5,0]]);
  assert.equal(result.elderGiftClaimed, false);
  assert.equal(result.shieldCharges, 0);
  for (const rulesVersion of [1,2,3,4]) {
    const run = createRun({ ...settings, rulesVersion, shieldCharges:2 });
    startRun(run);
    assert.equal(run.shieldCharges, 2);
    assert.equal(claimElderShield(run, { ...GUARDIAN }), false);
    assert.equal(activateShield(run), true);
    assert.equal(run.shieldCharges, 1);
    assert.throws(() => replayRun({ ...settings, rulesVersion }, [[1,0,0,0,4,0]]), /Elder gifts are not enabled/);
  }
});
