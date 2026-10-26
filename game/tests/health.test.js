import test from 'node:test';
import assert from 'node:assert/strict';
import { getHealth } from '../src/health.js';
import { createRun, startRun, hitHazard, advanceRun } from '../src/run-rules.js';
import { CHALLENGE_RULES_VERSION } from '../src/challenge-rules.js';

test('four- and three-hit budgets map to clear, rounded health values', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(hits => getHealth({ maxHits:4, hits }).current), [100, 75, 50, 25, 0]);
  assert.deepEqual([0, 1, 2, 3].map(hits => getHealth({ maxHits:3, hits }).current), [100, 67, 33, 0]);
  assert.equal(getHealth({ maxHits:3, hits:1 }).ratio, 2 / 3);
});

test('unlimited health does not report a misleading full health value', () => {
  for (const maxHits of [null, undefined, Infinity, NaN, 0, -2]) {
    assert.deepEqual(getHealth({ maxHits, hits:8 }), { enabled:false, current:null, max:100, ratio:null, remainingHits:null });
  }
});

test('health stays within its bounds for excess or negative hits', () => {
  assert.deepEqual(getHealth({ maxHits:4, hits:12 }), { enabled:true, current:0, max:100, ratio:0, remainingHits:0 });
  assert.deepEqual(getHealth({ maxHits:4, hits:-3 }), { enabled:true, current:100, max:100, ratio:1, remainingHits:4 });
  assert.equal(getHealth({ maxHits:4, hits:NaN }).current, 100);
});

test('health tracks accepted damage and reaches zero on the fatal hit', () => {
  const run = createRun({ mode:'storm', maxHits:3, rulesVersion:CHALLENGE_RULES_VERSION });
  startRun(run);
  assert.equal(getHealth(run).current, 100);
  assert.equal(hitHazard(run), true);
  assert.equal(getHealth(run).current, 67);
  assert.equal(hitHazard(run), false);
  assert.equal(getHealth(run).current, 67);
  advanceRun(run, 2);
  hitHazard(run);
  assert.equal(getHealth(run).current, 33);
  advanceRun(run, 2);
  hitHazard(run);
  assert.equal(getHealth(run).current, 0);
  assert.equal(run.status, 'failed');
});
