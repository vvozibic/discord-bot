import test from 'node:test';
import assert from 'node:assert/strict';
import { createDamageFeedback } from '../src/damage-feedback.js';

test('an impact has bounded, temporary camera feedback and readable damage text', () => {
  const feedback = createDamageFeedback();
  feedback.hit({ x:100, y:100, direction:{ x:1,y:0 }, damage:25 });
  assert.equal(feedback.sample().labels[0].text, '−25 HP');
  feedback.advance(.08);
  assert.ok(Math.abs(feedback.sample().shake.x) <= 2.3);
  assert.ok(feedback.sample().recoil > 0);
  feedback.advance(.4);
  assert.equal(feedback.sample().strength, 0);
  assert.equal(feedback.sample().labels.length, 1);
  feedback.advance(.5);
  assert.equal(feedback.sample().labels.length, 0);
});

test('reduced motion retains the damage number while removing shake, recoil and sparks', () => {
  const feedback = createDamageFeedback();
  feedback.hit({ x:40, y:80, damage:33, hazard:'lava' });
  feedback.advance(.1);
  const result = feedback.sample(true);
  assert.deepEqual(result.shake, { x:0,y:0 });
  assert.equal(result.recoil, 0);
  assert.deepEqual(result.sparks, []);
  assert.equal(result.labels[0].text, '−33 HP');
});

test('feedback clears between attempts and rejects invalid clock deltas', () => {
  const feedback = createDamageFeedback();
  for (let index = 0; index < 8; index++) feedback.hit({ x:0,y:0 });
  assert.equal(feedback.sample().labels.length, 4);
  for (const dt of [NaN,Infinity,-1,0]) feedback.advance(dt);
  assert.equal(feedback.sample().strength, 1);
  feedback.clear();
  assert.equal(feedback.sample().labels.length, 0);
  assert.equal(feedback.sample().strength, 0);
});
