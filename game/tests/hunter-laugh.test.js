import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeHunterLaugh, createHunterLaughCue } from '../src/hunter-laugh.js';

test('the laugh produces finite, bounded audio at mobile and desktop sample rates', () => {
  for (const sampleRate of [8000,24000,44100,48000]) {
    const samples = synthesizeHunterLaugh(sampleRate);
    assert.ok(samples.length > sampleRate && samples.length <= sampleRate * 2);
    let power = 0, peak = 0;
    for (const value of samples) { assert.ok(Number.isFinite(value)); power += value * value; peak = Math.max(peak, Math.abs(value)); }
    assert.ok(peak > .1 && peak <= .86, 'audible waveform without clipping');
    assert.ok(Math.sqrt(power / samples.length) > .01);
    assert.equal(Math.abs(samples[0]), 0);
    assert.equal(Math.abs(samples.at(-1)), 0);
  }
  assert.deepEqual(synthesizeHunterLaugh(8000), synthesizeHunterLaugh(8000));
  for (const rate of [0,NaN,Infinity,1000000]) assert.throws(() => synthesizeHunterLaugh(rate), /sample rate/);
});

test('hunter taunts start on waking, repeat during a chase, and respect paused simulation time and resets', () => {
  const cues = createHunterLaughCue(), player = { x:100,y:100 }, hunter = { x:200,y:100,state:'sleeping' };
  assert.equal(cues.update(null,0,player),null);
  assert.equal(cues.update(hunter,5,player),null);
  hunter.state = 'warning';
  const wake = cues.update(hunter,6,player);
  assert.ok(wake.proximity > 0 && wake.proximity < 1);
  for (let i = 0; i < 100; i++) assert.equal(cues.update(hunter,6,player),null);
  hunter.state = 'active';
  assert.equal(cues.update(hunter,13.99,player),null);
  assert.ok(cues.update(hunter,14,player));
  cues.reset();
  assert.ok(cues.update(hunter,1,player));
  cues.reset(); hunter.x = 1000;
  assert.equal(cues.update(hunter,1,player).proximity,0);
});
