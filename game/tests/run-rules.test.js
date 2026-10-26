import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, createRun, startRun, advanceRun, collectCore, collectBonus, activateShield, activateDash, movementMultiplier, hitHazard, finishRun, getRemainingTime } from '../src/run-rules.js';

function running(mode = 'journey', options = {}) {
  const run = createRun({ mode, ...options });
  startRun(run);
  return run;
}

test('runs start once and ignore actions before the first move', () => {
  const run = createRun();
  assert.equal(MODES.length, 2);
  assert.equal(run.status, 'ready');
  assert.equal(collectCore(run), false);
  advanceRun(run, 30);
  assert.equal(run.elapsed, 0);
  assert.equal(finishRun(run), false);
  assert.equal(startRun(run), true);
  assert.equal(startRun(run), false);
  assert.equal(run.status, 'running');
});

test('Journey has no deadline, ignores hazards and rewards optional detours', () => {
  const run = running('journey', { itemCount: 2 });
  assert.equal(getRemainingTime(run), null);
  assert.equal(activateShield(run), false);
  assert.equal(hitHazard(run), false);
  advanceRun(run, 1200);
  assert.equal(run.status, 'running');
  assert.equal(finishRun(run), false);
  assert.equal(collectCore(run), true);
  assert.equal(collectCore(run), true);
  assert.equal(collectCore(run), false);
  assert.equal(collectBonus(run), true);
  assert.equal(collectBonus(run), true);
  assert.equal(collectBonus(run), false);
  assert.equal(finishRun(run), true);
  assert.equal(run.score, 900);
  const completed = { ...run };
  assert.equal(finishRun(run), false);
  assert.equal(collectBonus(run), false);
  assert.equal(hitHazard(run), false);
  advanceRun(run, 10);
  assert.deepEqual(run, completed);
});

test('Storm expires exactly at the deadline and cannot be completed afterward', () => {
  const run = running('storm', { itemCount: 1 });
  collectCore(run);
  advanceRun(run, 89.75);
  assert.equal(run.status, 'running');
  assert.equal(getRemainingTime(run), .25);
  advanceRun(run, .25);
  assert.equal(run.status, 'failed');
  assert.equal(getRemainingTime(run), 0);
  assert.equal(finishRun(run), false);
  assert.equal(collectCore(run), false);
  assert.equal(startRun(run), false);
});

test('shields block hazards for three seconds and consume at most two charges', () => {
  const run = running('storm');
  assert.equal(activateShield(run), true);
  assert.equal(run.shieldCharges, 1);
  assert.equal(activateShield(run), false);
  assert.equal(run.shieldCharges, 1);
  assert.equal(hitHazard(run), false);
  advanceRun(run, 2.99);
  assert.equal(hitHazard(run), false);
  advanceRun(run, .01);
  assert.equal(hitHazard(run), true);
  assert.equal(activateShield(run), true);
  assert.equal(run.shieldCharges, 0);
  advanceRun(run, 3);
  assert.equal(activateShield(run), false);
  assert.equal(run.shieldRemaining, 0);
});

test('hazards remove points, add time and give a two-second collision grace period', () => {
  const run = running('storm');
  collectCore(run);
  collectBonus(run);
  assert.equal(hitHazard(run), true);
  assert.equal(run.hits, 1);
  assert.equal(run.score, 200);
  assert.equal(run.elapsed, 8);
  assert.equal(hitHazard(run), false);
  advanceRun(run, 2);
  assert.equal(hitHazard(run), true);
  assert.equal(run.hits, 2);
  assert.equal(run.elapsed, 18);
  assert.equal(run.score, 100);
  advanceRun(run, 2);
  hitHazard(run);
  advanceRun(run, 2);
  hitHazard(run);
  assert.equal(run.score, 0);
  const expiry = running('storm');
  advanceRun(expiry, 82);
  assert.equal(hitHazard(expiry), true);
  assert.equal(expiry.status, 'failed');
  assert.equal(getRemainingTime(expiry), 0);
  assert.equal(activateShield(expiry), false);
});

test('a successful Storm run receives its completion and whole-second speed bonuses once', () => {
  const run = running('storm', { itemCount: 2 });
  collectCore(run);
  collectCore(run);
  collectBonus(run);
  advanceRun(run, 20.2);
  assert.equal(finishRun(run), true);
  assert.equal(run.status, 'won');
  assert.equal(run.score, 200 + 200 + 300 + 69 * 5);
  assert.equal(finishRun(run), false);
  assert.equal(activateShield(run), false);
});

test('invalid deltas do not corrupt a run, and invalid run configurations are rejected', () => {
  const run = running();
  for (const dt of [NaN, Infinity, -1, 0, '5', null, undefined]) advanceRun(run, dt);
  assert.equal(run.elapsed, 0);
  assert.throws(() => createRun({ mode: 'unknown' }), RangeError);
  assert.throws(() => createRun({ itemCount: NaN }), RangeError);
  assert.throws(() => createRun({ itemCount: 0 }), RangeError);
  assert.throws(() => createRun({ bonusCount: -1 }), RangeError);
  assert.throws(() => createRun({ bonusCount: 1.5 }), RangeError);
  for (const timeLimit of [NaN, Infinity, -1, 0, 601, '90']) assert.throws(() => createRun({ timeLimit }), RangeError);
  assert.throws(() => createRun({ shieldCharges:-1 }), RangeError);
});

test('dash boosts movement briefly and cannot be refreshed before its cooldown ends', () => {
  const run = createRun({ mode:'storm', rulesVersion:3, mechanics:{ dash:true } });
  assert.equal(run.dashEnabled, true);
  assert.equal(activateDash(run), false);
  startRun(run);
  assert.equal(movementMultiplier(run), 1);
  assert.equal(activateDash(run), true);
  assert.equal(movementMultiplier(run), 2.3);
  assert.equal(run.dashRemaining, .18);
  assert.equal(run.dashCooldown, 3.5);
  assert.equal(activateDash(run), false);
  assert.equal(run.dashCooldown, 3.5);
  advanceRun(run, .18);
  assert.equal(run.dashRemaining, 0);
  assert.equal(movementMultiplier(run), 1);
  assert.equal(activateDash(run), false);
  advanceRun(run, 3.32);
  assert.equal(run.dashCooldown, 0);
  assert.equal(activateDash(run), true);
  advanceRun(run, 90);
  assert.equal(run.status, 'failed');
  assert.equal(run.dashRemaining, 0);
  assert.equal(activateDash(run), false);
});

test('legacy and version-two runs cannot gain dash through untrusted mechanic flags', () => {
  for (const rulesVersion of [undefined, 1, 2, 3]) {
    const run = running('storm', { rulesVersion, mechanics:{ dash:rulesVersion === 3 ? false : true } });
    assert.equal(run.dashEnabled, false);
    assert.equal(activateDash(run), false);
    assert.equal(movementMultiplier(run), 1);
  }
});
