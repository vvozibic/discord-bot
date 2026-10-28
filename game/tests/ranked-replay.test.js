import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunTrace, MAX_TRACE_TICKS } from '../src/run-trace.js';
import { replayRun } from '../server/replay.js';
import { recordedVictory } from './fixtures/ranked-run.js';
import { DEFAULT_MECHANICS } from '../src/challenge-rules.js';

// These configs deliberately have no rulesVersion: previously issued tickets
// must retain their original challenge and score after the harder rules ship.
function legacyConfig(seed, options = {}) {
  return { seed, layoutId:'crossing', mode:'journey', enemies:[], patrolSpeed:1, timeLimit:null, shieldCharges:0, ...options };
}

test('server replay verifies complete routes on every map and derives points from pickups', () => {
  const layouts = new Set();
  for (let seed = 0; seed < 9; seed++) {
    const config = legacyConfig(`ranked-${seed}`, { layoutId:['crossing','waterside','switchback'][seed % 3] });
    layouts.add(config.layoutId);
    const recording = recordedVictory(config, { repeatTarget:true });
    const result = replayRun(config, recording.trace);
    assert.equal(result.status, 'won');
    assert.equal(result.score, 1300);
    assert.equal(result.collected, 6);
    assert.equal(result.bonuses, 2);
    assert.ok(Math.abs(result.elapsed - recording.seconds) < .001);
  }
  assert.equal(layouts.size, 3);
});

test('replaying the same route with version-twelve retry time does not raise its verified score', () => {
  const first = legacyConfig('retry-scoring-replay', {
    rulesVersion:12, mode:'storm', timeLimit:70, scoreTimeLimit:70,
    mechanics:Object.fromEntries(Object.keys(DEFAULT_MECHANICS).map(key => [key,false])),
  });
  const recording = recordedVictory(first);
  const initial = replayRun(first, recording.trace);
  const assisted = replayRun({ ...first, timeLimit:80 }, recording.trace);
  assert.equal(initial.status, 'won'); assert.equal(assisted.status, 'won');
  assert.equal(assisted.elapsed, initial.elapsed);
  assert.equal(assisted.score, initial.score);
  assert.equal(assisted.bonuses, initial.bonuses);
  const legacy = replayRun({ ...first, rulesVersion:11, timeLimit:80 }, recording.trace);
  assert.equal(legacy.status, 'won'); assert.equal(legacy.elapsed, initial.elapsed);
  assert.equal(legacy.score, initial.score + 50, 'issued v11 tickets preserve the previous time-bonus formula');
  assert.equal(Object.hasOwn(legacy, 'scoreTimeLimit'), false);
});

test('input recording compresses repeated ticks without losing shield or repeated path clicks', () => {
  const trace = createRunTrace();
  trace.repath(); trace.step(2, 100, 200); trace.step(2, 100, 200);
  trace.shield(); trace.step(2, 100, 200); trace.step(2, 100, 200);
  trace.repath(); trace.step(2, 100, 200);
  assert.deepEqual(trace.snapshot(), [[2,2,100,200,0,1],[2,2,100,200,1,0],[1,2,100,200,0,1]]);
  const copy = trace.snapshot(); copy[0][0] = 999;
  assert.equal(trace.snapshot()[0][0], 2);
});

test('ranked replay rejects forged speed, unfinished runs, excess frames and malformed packets', () => {
  const config = legacyConfig('invalid-trace');
  for (const trace of [[], [[10,1,4,0,0,0]], [[1,2,-1,100,0,1]], [[1,1,NaN,0,0,0]], [[1,0,0,0,0]], [[1,0,0,0,2,0]], [[MAX_TRACE_TICKS+1,0,0,0,0,0]], [[60,0,0,0,0,0]]])
    assert.throws(() => replayRun(config, trace));
  const recording = recordedVictory(config);
  assert.throws(() => replayRun(config, [...recording.trace, [1,0,0,0,0,0]]));
});

test('recording over the ranking limit leaves the local game usable and declines publication', () => {
  const trace = createRunTrace();
  for (let index = 0; index <= MAX_TRACE_TICKS; index++) trace.step(0);
  assert.throws(() => trace.snapshot(), /too long/);
});

test('timed failures and shield charges are reproduced by the server', () => {
  const config = legacyConfig('timed-verification', { mode:'storm', timeLimit:150, shieldCharges:3 });
  const result = replayRun(config, [[1,1,1,0,0,0],[8999,0,0,0,1,0]]);
  assert.equal(result.status, 'failed');
  assert.equal(result.score, 0);
  assert.equal(result.shieldCharges, 2);
});

test('previously issued factory runs retain their original rules and can still be verified', () => {
  for (let seed = 0; seed < 12; seed++) {
    const config = legacyConfig(`verified-factory-${seed}:level:2`, {
      layoutId:'rustworks', mode:'storm', timeLimit:180, shieldCharges:3, enemies:['wisp','wisp'], patrolSpeed:.9,
    });
    const recording = recordedVictory(config, { repeatTarget:true });
    const result = replayRun(config, recording.trace);
    assert.equal(config.layoutId, 'rustworks');
    assert.equal(result.status, 'won');
    assert.equal(result.collected, 6);
    assert.equal(result.bonuses, 2);
    assert.ok(result.elapsed < 180);
    assert.ok(Number.isFinite(result.score));
  }
});

test('version-two replay is deterministic and compression preserves one-shot shield actions', () => {
  const config = legacyConfig('compressed-v2', {
    rulesVersion:2, mode:'storm', timeLimit:150, shieldCharges:3,
    mechanics:{ orderedCoins:false, pulseTraps:false, alarm:false, armor:false, exitWindow:false },
  });
  const trace = [[1,1,1,0,0,0],[8999,0,0,0,1,0]];
  const expanded = trace.flatMap(([ticks, kind, x, y, shield, repath]) => Array.from({ length:ticks }, (_, index) => [1,kind,x,y,index ? 0 : shield,index ? 0 : repath]));
  const result = replayRun(config, trace);
  assert.equal(result.status, 'failed');
  assert.equal(result.shieldCharges, 2);
  assert.deepEqual(replayRun(config, trace), result);
  assert.deepEqual(replayRun(config, expanded), result);
});

test('shield and dash bits record one-shot actions without changing the six-field trace format', () => {
  const trace = createRunTrace();
  trace.step(1, 1, 0);
  trace.shield(); trace.dash(); trace.step(1, 1, 0); trace.step(1, 1, 0);
  trace.dash(); trace.step(1, 1, 0);
  assert.deepEqual(trace.snapshot(), [[1,1,1,0,0,0],[2,1,1,0,3,0],[1,1,1,0,2,0]]);
});

test('version-three replay preserves dash and shield actions when packets are compressed', () => {
  const config = legacyConfig('compressed-v3', {
    rulesVersion:3, mode:'storm', timeLimit:150, shieldCharges:3,
    mechanics:{ orderedCoins:false, pulseTraps:false, alarm:false, armor:false, exitWindow:false,
      lava:false, crumble:false, lasers:false, hunter:false, dash:true },
  });
  const trace = [[1,1,1,0,0,0],[12,1,1,0,3,0],[8987,0,0,0,0,0]];
  const expanded = trace.flatMap(([ticks, kind, x, y, actions, repath]) => Array.from({ length:ticks }, (_, index) => [1,kind,x,y,index ? 0 : actions,index ? 0 : repath]));
  const result = replayRun(config, trace);
  assert.equal(result.status, 'failed');
  assert.equal(result.shieldCharges, 2);
  assert.equal(result.dashEnabled, true);
  assert.deepEqual(replayRun(config, expanded), result);
  assert.deepEqual(replayRun(config, trace), result);
});

test('ranked verification rejects unavailable dash abilities and unknown action bits', () => {
  for (const config of [legacyConfig('forged-legacy-dash'), legacyConfig('forged-v2-dash', { rulesVersion:2 }),
    legacyConfig('disabled-v3-dash', { rulesVersion:3, mechanics:{ dash:false } })]) {
    assert.throws(() => replayRun(config, [[1,1,1,0,2,0]]), /Dash is not enabled/);
  }
  const config = legacyConfig('unknown-actions', { rulesVersion:3 });
  for (const actions of [-1, 1.5, 64, NaN, Infinity, true]) assert.throws(() => replayRun(config, [[1,1,1,0,actions,0]]), /Invalid input packet/);
  assert.throws(() => replayRun(config, [[1,1,1,0,4,0]]), /Elder gifts are not enabled/);
});
