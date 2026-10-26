import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameAudio } from '../src/audio.js';

function audioEnvironment() {
  const originals = ['AudioContext', 'webkitAudioContext', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const instances = [];
  const stored = new Map();
  const param = () => ({
    value: 0, events: [],
    setValueAtTime(value, time) { this.events.push({ value, time }); },
    cancelScheduledValues() {},
    exponentialRampToValueAtTime(value, time) { this.events.push({ value, time }); },
  });
  class FakeContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.state = 'suspended';
      this.destination = {};
      this.sources = [];
      this.nodes = [];
      this.buffers = 0;
      this.resumeAttempts = 0;
      instances.push(this);
    }
    node(properties) {
      const node = { ...properties, disconnected: false, connect() {}, disconnect() { this.disconnected = true; } };
      this.nodes.push(node);
      return node;
    }
    createGain() { return this.node({ gain: param() }); }
    createBiquadFilter() { return this.node({ frequency: param(), Q: param() }); }
    createBuffer(_channels, length) { this.buffers++; const data = new Float32Array(length); return { length, getChannelData: () => data }; }
    createOscillator() { return this.source({ frequency: param() }); }
    createBufferSource() { return this.source({ playbackRate: param() }); }
    source(properties) {
      const node = this.node({ ...properties, started: false, stopped: false, start() { this.started = true; }, stop(when) { if (when === undefined) this.stopped = true; } });
      this.sources.push(node);
      return node;
    }
    resume() {
      this.resumeAttempts++;
      if (this.rejectResume) return Promise.reject(new Error('Gesture required'));
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext });
  Object.defineProperty(globalThis, 'webkitAudioContext', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) } });
  return {
    instances, stored,
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('effects create no audio context until an explicit gesture unlock', async () => {
  const env = audioEnvironment();
  try {
    const states = [];
    const audio = createGameAudio({ onStateChange: state => states.push(state) });
    audio.step(); audio.collect(); audio.talk(); audio.portalOpen(); audio.hit(); audio.hit('lava', 1.5); audio.hit('laser'); audio.shield(); audio.magicCast(); audio.magicHit(); audio.hunterDash(); audio.hunterDash(true); audio.hunterLaugh(); audio.bonus(); audio.win(); audio.restart();
    assert.equal(env.instances.length, 0);
    assert.equal(await audio.unlock(), true);
    assert.equal(env.instances.length, 1);
    audio.collect(0);
    assert.equal(env.instances[0].sources.length, 2);
    assert.equal(states.at(-1).unlocked, true);
  } finally { env.restore(); }
});

test('damage has a physical body and distinct heat and laser textures, reusing the footstep noise', async () => {
  const env = audioEnvironment();
  try {
    const audio = createGameAudio();
    await audio.unlock();
    const context = env.instances[0];
    audio.step();
    audio.hit('hunter');
    const physicalSources = context.sources.slice(1);
    assert.ok(physicalSources.some(source => source.frequency?.events.some(event => event.value < 120)), 'impact has a low body');
    assert.ok(physicalSources.some(source => source.buffer), 'impact includes a short noise transient');
    let before = context.nodes.length;
    audio.hit('lava');
    assert.ok(context.nodes.slice(before).some(node => node.type === 'highpass'), 'heat has a hiss');
    before = context.nodes.length;
    audio.hit('laser');
    assert.ok(context.nodes.slice(before).some(node => node.type === 'sawtooth'), 'laser has an electronic zap');
    assert.equal(context.buffers, 1);
    const noiseSources = context.sources.filter(source => source.buffer);
    assert.ok(noiseSources.every(source => source.buffer === noiseSources[0].buffer));
    assert.ok(context.sources.every(source => source.started));
  } finally { env.restore(); }
});

test('hunter laughter is audible, cached, throttled and cleaned up on mute, pause and restart', async () => {
  const env = audioEnvironment();
  try {
    const audio = createGameAudio();
    await audio.unlock();
    const context = env.instances[0];
    audio.hunterLaugh(.5);
    assert.equal(context.buffers, 1);
    assert.equal(context.sources.length, 1);
    const first = context.sources[0];
    assert.ok(first.buffer.getChannelData(0).some(value => Math.abs(value) > .1));
    assert.ok(first.started);
    audio.hunterLaugh();
    assert.equal(context.sources.length, 1, 'per-frame calls cannot spam laughter');
    first.onended();
    assert.ok(first.disconnected);
    context.currentTime = 8;
    audio.hunterLaugh(Infinity);
    assert.equal(context.sources.at(-1).buffer, first.buffer);
    assert.equal(context.buffers, 1, 'reuse the synthesized waveform');
    audio.setActive(false);
    assert.ok(context.nodes.slice(1).every(node => node.disconnected));
    const count = context.sources.length;
    audio.hunterLaugh();
    assert.equal(context.sources.length, count);
    audio.setActive(true); await Promise.resolve();
    audio.setMuted(true);
    audio.hunterLaugh();
    assert.equal(context.sources.length, count);
    audio.setMuted(false); await Promise.resolve();
    audio.restart();
    const before = context.sources.length;
    audio.hunterLaugh();
    assert.equal(context.sources.length, before + 1, 'new attempts can play a fresh wake-up cue');
    audio.setActive(false);
    assert.ok(context.nodes.slice(1).every(node => node.disconnected));
  } finally { env.restore(); }
});

test('damage voices disconnect all nodes on completion and remain bounded during rapid hits', async () => {
  const env = audioEnvironment();
  try {
    const audio = createGameAudio();
    await audio.unlock();
    const context = env.instances[0];
    audio.hit('trap');
    for (const source of context.sources) source.onended();
    assert.ok(context.nodes.slice(1).every(node => node.disconnected));
    for (let i = 0; i < 20; i++) audio.hit('sentinel');
    assert.ok(context.sources.filter(source => !source.disconnected).length <= 18);
    audio.setActive(false);
    assert.ok(context.nodes.slice(1).every(node => node.disconnected));
    assert.ok(context.sources.every(source => source.onended === null));
    const pausedCount = context.sources.length;
    audio.hit('hunter');
    assert.equal(context.sources.length, pausedCount);
    audio.setActive(true);
    await Promise.resolve();
    audio.hit('crumble');
    audio.setMuted(true);
    const mutedCount = context.sources.length;
    audio.hit('laser');
    assert.equal(context.sources.length, mutedCount);
    assert.ok(context.nodes.slice(1).every(node => node.disconnected));
  } finally { env.restore(); }
});

test('damage intensity cannot schedule invalid or excessively loud parameters', async () => {
  const env = audioEnvironment();
  try {
    const audio = createGameAudio();
    await audio.unlock();
    const context = env.instances[0];
    for (const severity of [NaN, Infinity, -100, 100000]) audio.hit('trap', severity);
    const levels = context.nodes.flatMap(node => node.gain?.events.map(event => event.value) || []);
    assert.ok(levels.every(value => Number.isFinite(value) && value > 0 && value < 0.3));
    const frequencies = context.nodes.flatMap(node => node.frequency?.events.map(event => event.value) || []);
    assert.ok(frequencies.every(value => Number.isFinite(value) && value >= 20 && value <= 20000));
  } finally { env.restore(); }
});

test('footsteps throttle movement calls and reuse one noise buffer', async () => {
  const env = audioEnvironment();
  try {
    const audio = createGameAudio();
    await audio.unlock();
    const context = env.instances[0];
    audio.step();
    for (let i = 0; i < 10; i++) audio.step();
    assert.equal(context.sources.length, 1);
    context.currentTime = 0.25;
    audio.step();
    assert.equal(context.sources.length, 2);
    assert.equal(context.buffers, 1);
  } finally { env.restore(); }
});

test('hide and mute stop scheduled effects, suspend audio, and retain the mute preference', async () => {
  const env = audioEnvironment();
  try {
    const audio = createGameAudio();
    await audio.unlock();
    const context = env.instances[0];
    audio.win();
    audio.setActive(false);
    assert.equal(context.state, 'suspended');
    assert.ok(context.sources.every(source => source.stopped && source.disconnected));
    const hiddenCount = context.sources.length;
    audio.collect();
    assert.equal(context.sources.length, hiddenCount);
    audio.setActive(true);
    await Promise.resolve();
    assert.equal(context.state, 'running');
    audio.collect();
    audio.setMuted(true);
    assert.equal(context.state, 'suspended');
    assert.ok(context.sources.every(source => source.stopped && source.disconnected));
    assert.equal(createGameAudio().muted, true);
    audio.toggleMute();
    await Promise.resolve();
    assert.equal(context.state, 'running');
    assert.equal(createGameAudio().muted, false);
  } finally { env.restore(); }
});

test('a rejected autoplay resume is handled and the next gesture can retry', async () => {
  const env = audioEnvironment();
  try {
    const Base = globalThis.AudioContext;
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class extends Base { constructor() { super(); this.rejectResume = true; } } });
    const audio = createGameAudio();
    assert.equal(await audio.unlock(), false);
    assert.equal(audio.available, true);
    const context = env.instances[0];
    audio.collect();
    assert.equal(context.sources.length, 0);
    context.rejectResume = false;
    assert.equal(await audio.unlock(), true);
    assert.equal(context.resumeAttempts, 2);
  } finally { env.restore(); }
});

test('unsupported audio, blocked storage, and construction failures degrade gracefully', async () => {
  const env = audioEnvironment();
  try {
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage denied'); } });
    const unsupported = createGameAudio();
    assert.equal(unsupported.available, false);
    assert.equal(await unsupported.unlock(), false);
    unsupported.toggleMute(); unsupported.step(); unsupported.win(); unsupported.setActive(false);
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { constructor() { throw new Error('Device unavailable'); } } });
    const failed = createGameAudio();
    assert.equal(await failed.unlock(), false);
    assert.equal(failed.available, false);
  } finally { env.restore(); }
});
