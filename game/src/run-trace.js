export const MAX_TRACE_TICKS = 108000; // Thirty minutes of simulation per ranked attempt.
export const MAX_TRACE_PACKETS = 12000;

export function createRunTrace() {
  const packets = [];
  let ticks = 0, overflow = false, pendingShield = false, pendingDash = false, pendingElder = false, pendingPath = false;
  let pendingMagic = false, pendingCharacter = 0;
  return {
    shield() { pendingShield = true; },
    dash() { pendingDash = true; },
    elder() { pendingElder = true; },
    magic() { pendingMagic = true; },
    character(id) { if (id === 'wizard' || id === 'robot') pendingCharacter = id === 'wizard' ? 16 : 32; },
    repath() { pendingPath = true; },
    step(kind, x = 0, y = 0) {
      if (overflow) return;
      const actions = (pendingShield ? 1 : 0) | (pendingDash ? 2 : 0) | (pendingElder ? 4 : 0) | (pendingMagic ? 8 : 0) | pendingCharacter;
      const repath = pendingPath && kind === 2 ? 1 : 0;
      pendingShield = false; pendingDash = false; pendingElder = false; pendingPath = false;
      pendingMagic = false; pendingCharacter = 0;
      if (++ticks > MAX_TRACE_TICKS) { overflow = true; return; }
      const previous = packets.at(-1);
      if (!actions && !repath && previous && previous[1] === kind && previous[2] === x && previous[3] === y) previous[0]++;
      else packets.push([1, kind, x, y, actions, repath]);
      if (packets.length > MAX_TRACE_PACKETS) overflow = true;
    },
    snapshot() {
      if (overflow) throw new Error('This attempt is too long to rank. Your local result is still saved.');
      return packets.map(packet => [...packet]);
    },
  };
}
