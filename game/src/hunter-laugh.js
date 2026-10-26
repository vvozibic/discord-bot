/** A breathy, descending five-syllable laugh, synthesized once per audio context. */
export function synthesizeHunterLaugh(sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Invalid sample rate');
  const syllables = [[0,.21,112],[.26,.23,102],[.55,.25,94],[.87,.28,85],[1.23,.34,73]];
  const samples = new Float32Array(Math.ceil(sampleRate * 1.96));
  const filters = [[540,4.5,.85],[1080,7,.5],[2180,10,.22]].map(([frequency, q, level]) => {
    const omega = 2 * Math.PI * frequency / sampleRate, alpha = Math.sin(omega) / (2 * q);
    return { b:alpha / (1 + alpha), a1:-2 * Math.cos(omega) / (1 + alpha), a2:(1 - alpha) / (1 + alpha), y1:0, y2:0, level };
  });
  let phase = 0, previousInput = 0, olderInput = 0, seed = 7391;
  for (let index = 0; index < samples.length; index++) {
    const time = index / sampleRate;
    const syllable = syllables.find(([start, duration]) => time >= start && time < start + duration);
    let input = 0, envelope = 0, breath = 0;
    if (syllable) {
      const age = time - syllable[0], progress = age / syllable[1];
      envelope = Math.min(1, age / .025) * (1 - progress) ** .7;
      const pitch = syllable[2] + Math.sin(progress * Math.PI) * 13 - progress * 17 + Math.sin(time * 51) * 2;
      phase += pitch / sampleRate;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      input = Math.tanh((2 * (phase % 1) - 1) * 2.7) * (.8 + .2 * Math.sin(time * 37)) + noise * .14;
      breath = noise * Math.exp(-age * 55) * .12;
    }
    let vowel = 0;
    for (const filter of filters) {
      const value = filter.b * (input - olderInput) - filter.a1 * filter.y1 - filter.a2 * filter.y2;
      filter.y2 = filter.y1; filter.y1 = value;
      vowel += value * filter.level;
    }
    olderInput = previousInput; previousInput = input;
    samples[index] = (vowel * 2.8 + Math.sin(phase * Math.PI) * .15 + breath) * envelope;
  }
  // A short, dark echo trails each chuckle without allocating live reverb nodes.
  const dry = samples.slice();
  for (const [delay, gain] of [[.09,.23],[.19,.13],[.32,.065]]) {
    const offset = Math.round(delay * sampleRate);
    for (let index = offset; index < samples.length; index++) samples[index] += dry[index - offset] * gain;
  }
  let peak = .001;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  for (let index = 0; index < samples.length; index++) samples[index] *= .85 / peak;
  return samples;
}

/** Simulation time keeps chase taunts paused with the trail, with no wall-clock timers. */
export function createHunterLaughCue() {
  let nextAt = -Infinity;
  return {
    reset() { nextAt = -Infinity; },
    update(hunter, clock, player) {
      if (!hunter || hunter.stunRemaining > 0 || !['warning','active'].includes(hunter.state) || !Number.isFinite(clock) || clock < nextAt) return null;
      nextAt = clock + 8;
      const distance = Math.hypot(player.x - hunter.x, player.y - hunter.y);
      return { proximity:Math.max(0, Math.min(1, 1 - distance / 420)) };
    },
  };
}
