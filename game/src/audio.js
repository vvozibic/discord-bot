import { synthesizeHunterLaugh } from './hunter-laugh.js';

const STORAGE_KEY = 'forest-trail-muted';
const MASTER_VOLUME = 0.2;
const PICKUP_NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];

/** Quiet, asset-free effects. Call unlock() directly from a pointer/key gesture. */
export function createGameAudio({ onStateChange } = {}) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  let available = typeof Context === 'function';
  let muted = false;
  let active = true;
  let unlocked = false;
  let context = null;
  let master = null;
  let noise = null;
  let laughBuffer = null;
  let pendingResume = null;
  let lastStep = -Infinity;
  let lastTalk = -Infinity;
  let lastLaugh = -Infinity;
  const voices = new Set();

  try { muted = globalThis.localStorage?.getItem(STORAGE_KEY) === 'true'; } catch { /* Private browsing may deny storage. */ }

  function report() {
    try { onStateChange?.({ muted, available, unlocked }); } catch { /* UI callbacks must not interrupt the game. */ }
  }

  function setLevel() {
    if (!master || !context) return;
    try {
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(active && !muted ? MASTER_VOLUME : 0, now);
    } catch { /* An interrupted audio device must not interrupt input handling. */ }
  }

  function stopVoices() {
    for (const voice of [...voices]) voice.dispose(true);
  }

  function suspend() {
    if (!context || context.state === 'closed' || context.state === 'suspended') return;
    try { Promise.resolve(context.suspend()).catch(() => {}); } catch { /* Some embedded browsers reject suspend. */ }
  }

  function resume() {
    if (!context || !active || muted) return Promise.resolve(false);
    if (context.state === 'closed') {
      available = false;
      unlocked = false;
      report();
      return Promise.resolve(false);
    }
    if (context.state === 'running') {
      unlocked = true;
      setLevel();
      return Promise.resolve(true);
    }
    if (pendingResume) return pendingResume;

    // Invoke resume synchronously so mobile browsers retain the user gesture.
    try {
      pendingResume = Promise.resolve(context.resume()).then(() => {
        pendingResume = null;
        if (context.state === 'running') unlocked = true;
        setLevel();
        if (!active || muted) suspend();
        report();
        return unlocked && active && !muted && context.state === 'running';
      }).catch(() => {
        pendingResume = null;
        report();
        return false; // A future gesture can retry after an autoplay rejection.
      });
      return pendingResume;
    } catch {
      pendingResume = null;
      report();
      return Promise.resolve(false);
    }
  }

  function unlock() {
    if (!available || !active || muted) return Promise.resolve(false);
    if (!context) {
      try {
        context = new Context({ latencyHint: 'interactive' });
        master = context.createGain();
        master.gain.value = MASTER_VOLUME;
        master.connect(context.destination);
      } catch {
        if (context) {
          try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Nothing else can be cleaned up. */ }
        }
        context = null;
        master = null;
        available = false;
        report();
        return Promise.resolve(false);
      }
    }
    const result = resume();
    report();
    return result;
  }

  function canPlay() {
    return available && unlocked && active && !muted && context?.state === 'running';
  }

  function track(source, nodes) {
    const voice = {
      dispose(stop = false) {
        if (!voices.delete(voice)) return;
        source.onended = null;
        if (stop) { try { source.stop(); } catch { /* Already stopped. */ } }
        for (const node of nodes) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
      },
    };
    voices.add(voice);
    source.onended = () => voice.dispose();
    // Bound rapid input and repeated interactions on low-memory mobile devices.
    while (voices.size > 18) voices.values().next().value.dispose(true);
    return voice;
  }

  function tone(frequency, offset = 0, duration = 0.2, volume = 0.15, type = 'sine', endFrequency = frequency) {
    if (!canPlay()) return;
    let voice;
    const nodes = [];
    try {
      const start = context.currentTime + offset;
      const oscillator = context.createOscillator();
      nodes.push(oscillator);
      const envelope = context.createGain();
      nodes.push(envelope);
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (endFrequency !== frequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(volume, start + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope);
      envelope.connect(master);
      voice = track(oscillator, nodes);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    } catch {
      if (voice) voice.dispose(true);
      else for (const node of nodes) { try { node.disconnect(); } catch { /* Partially constructed effect. */ } }
    }
  }

  function noiseBuffer() {
    if (!noise) {
      noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.12), context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    return noise;
  }

  function transient({ frequency, endFrequency = frequency, duration = 0.09, volume = 0.1, type = 'bandpass', rate = 1 }) {
    if (!canPlay()) return;
    let voice;
    const nodes = [];
    try {
      const start = context.currentTime;
      const buffer = noiseBuffer();
      const source = context.createBufferSource();
      nodes.push(source);
      const filter = context.createBiquadFilter();
      nodes.push(filter);
      const envelope = context.createGain();
      nodes.push(envelope);
      source.buffer = buffer;
      source.playbackRate.value = rate;
      filter.type = type;
      filter.frequency.setValueAtTime(frequency, start);
      if (frequency !== endFrequency) filter.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      filter.Q.value = 0.7;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(volume, start + 0.003);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(master);
      voice = track(source, nodes);
      source.start(start);
      source.stop(start + duration + 0.01);
    } catch {
      if (voice) voice.dispose(true);
      else for (const node of nodes) { try { node.disconnect(); } catch { /* Partially constructed effect. */ } }
    }
  }

  function step(surface = 'grass') {
    if (!canPlay() || context.currentTime - lastStep < 0.24) return;
    lastStep = context.currentTime;
    let voice;
    try {
      const buffer = noiseBuffer();
      const start = context.currentTime;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      const wooden = surface === 'wood' || surface === 'bridge';
      source.buffer = buffer;
      source.playbackRate.value = wooden ? 0.9 : 1.05;
      filter.type = 'lowpass';
      filter.frequency.value = wooden ? 760 : surface === 'path' ? 1200 : 1700;
      filter.Q.value = 0.6;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(wooden ? 0.075 : 0.055, start + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.075);
      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(master);
      voice = track(source, [source, filter, envelope]);
      source.start(start);
      source.stop(start + 0.09);
      if (wooden) tone(140, 0, 0.065, 0.035, 'sine', 85);
    } catch { voice?.dispose(true); }
  }

  function collect(index = 0) {
    const note = PICKUP_NOTES[Math.max(0, Math.min(5, Math.floor(Number(index) || 0)))];
    tone(note, 0, 0.24, 0.15, 'triangle');
    tone(note * 2, 0.025, 0.3, 0.045);
  }

  function portalOpen() {
    [392, 523.25, 659.25, 1046.5].forEach((note, i) => tone(note, i * 0.09, 0.6, 0.1));
  }

  function talk() {
    if (!canPlay() || context.currentTime - lastTalk < 0.2) return;
    lastTalk = context.currentTime;
    tone(330, 0, 0.09, 0.09, 'sine', 392);
    tone(494, 0.09, 0.12, 0.06);
  }

  function hit(type = 'impact', severity = 1) {
    if (!canPlay()) return;
    const amount = Number(severity);
    const intensity = Number.isFinite(amount) ? Math.max(0.35, Math.min(1.5, amount)) : 1;
    if (type === 'lava') {
      // A short hot hiss communicates heat without a sharp collision sound.
      transient({ type: 'highpass', frequency: 2500, endFrequency: 950, duration: 0.11, volume: 0.14 * intensity });
      tone(95, 0, 0.14, 0.075 * intensity, 'sine', 55);
    } else if (type === 'laser') {
      transient({ frequency: 3600, endFrequency: 1500, duration: 0.065, volume: 0.085 * intensity });
      tone(660, 0, 0.11, 0.065 * intensity, 'sawtooth', 145);
      tone(100, 0, 0.16, 0.1 * intensity, 'sine', 42);
    } else {
      // Weight comes from the low body; the brief clank is the robot's shell.
      tone(type === 'crumble' ? 90 : 115, 0, 0.2, 0.18 * intensity, 'sine', 42);
      transient({ frequency: type === 'crumble' ? 1150 : 2100, endFrequency: 650, volume: 0.1 * intensity });
      tone(760, 0, 0.065, 0.035 * intensity, 'triangle', 280);
    }
  }

  function shield() {
    tone(392, 0, 0.22, 0.085, 'sine', 783.99);
  }
  function magicCast() {
    tone(260,0,.14,.09,'sine',880);
    tone(1046.5,.12,.18,.08,'triangle',440);
  }
  function magicHit(defeated = false) {
    tone(180,0,.16,.12,'sine',70);
    tone(880,0,.22,.085,'triangle',defeated ? 1318.5 : 587.33);
    if (defeated) tone(1568,.1,.4,.07);
  }
  function hunterDash(charging = false) {
    if (charging) {
      transient({ type:'bandpass',frequency:1800,endFrequency:500,duration:.11,volume:.12 });
      tone(150,0,.15,.1,'sawtooth',65);
    } else {
      tone(220,0,.13,.085,'triangle',440);
      tone(330,.18,.15,.07,'triangle',660);
    }
  }

  function hunterLaugh(proximity = 1) {
    if (!canPlay() || context.currentTime - lastLaugh < 4) return;
    let voice;
    const nodes = [];
    try {
      if (!laughBuffer) {
        const samples = synthesizeHunterLaugh(context.sampleRate);
        laughBuffer = context.createBuffer(1, samples.length, context.sampleRate);
        laughBuffer.getChannelData(0).set(samples);
      }
      const start = context.currentTime, duration = laughBuffer.length / context.sampleRate;
      const source = context.createBufferSource(); nodes.push(source);
      const filter = context.createBiquadFilter(); nodes.push(filter);
      const envelope = context.createGain(); nodes.push(envelope);
      const amount = Number(proximity), intensity = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1;
      source.buffer = laughBuffer;
      filter.type = 'lowpass'; filter.frequency.value = 2800; filter.Q.value = .6;
      envelope.gain.setValueAtTime(.0001, start);
      envelope.gain.exponentialRampToValueAtTime(.34 + intensity * .18, start + .015);
      envelope.gain.setValueAtTime(.34 + intensity * .18, start + duration - .15);
      envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
      source.connect(filter); filter.connect(envelope); envelope.connect(master);
      voice = track(source, nodes);
      source.start(start); source.stop(start + duration + .01);
      lastLaugh = start;
    } catch {
      if (voice) voice.dispose(true);
      else for (const node of nodes) { try { node.disconnect(); } catch { /* Partially constructed effect. */ } }
    }
  }

  function bonus() {
    [587.33, 739.99, 880].forEach((note, i) => tone(note, i * 0.11, i === 2 ? 0.34 : 0.18, 0.1));
  }

  function win() {
    [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((note, i) => {
      tone(note, i * 0.14, i === 5 ? 0.7 : 0.24, 0.13, 'triangle');
    });
    tone(261.63, 0.7, 0.8, 0.09);
    tone(659.25, 0.7, 0.8, 0.065);
  }

  function restart() {
    stopVoices();
    lastStep = -Infinity;
    lastTalk = -Infinity;
    lastLaugh = -Infinity;
    tone(392, 0, 0.14, 0.075);
    tone(523.25, 0.08, 0.18, 0.075);
  }

  function setMuted(value) {
    muted = Boolean(value);
    try { globalThis.localStorage?.setItem(STORAGE_KEY, String(muted)); } catch { /* Storage is optional. */ }
    setLevel();
    if (muted) {
      stopVoices();
      suspend();
    } else if (unlocked && active) {
      void resume();
    }
    report();
    return muted;
  }

  function setActive(value) {
    active = Boolean(value);
    setLevel();
    if (!active) {
      stopVoices();
      lastStep = -Infinity;
      suspend();
    } else if (unlocked && !muted) {
      void resume();
    }
  }

  report();
  return {
    unlock, setMuted, toggleMute: () => setMuted(!muted), step, collect, portalOpen,
    talk, hit, shield, magicCast, magicHit, hunterDash, hunterLaugh, bonus, win, restart, setActive,
    get muted() { return muted; },
    get available() { return available; },
  };
}
