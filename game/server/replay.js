import { WORLD } from '../src/world.js';
import { createSimulation, stepSimulation } from '../src/run-simulation.js';
import { MAX_TRACE_PACKETS, MAX_TRACE_TICKS } from '../src/run-trace.js';
import { mechanicsFor } from '../src/challenge-rules.js';

export function replayRun(config, packets) {
  const validationDeadline = performance.now() + 1500;
  if (config.rulesVersion >= 13 && (!['wizard','robot'].includes(config.character) || !['pursuit','machinery'].includes(config.variant))) throw new Error('Invalid character or trail variant');
  if (!Array.isArray(packets) || !packets.length || packets.length > MAX_TRACE_PACKETS) throw new Error('Invalid input trace');
  let totalTicks = 0;
  const dashEnabled = mechanicsFor(config).dash;
  for (const packet of packets) {
    if (!Array.isArray(packet) || packet.length !== 6) throw new Error('Invalid input packet');
    const [ticks, kind, x, y, actions, repath] = packet;
    if (!Number.isSafeInteger(ticks) || ticks < 1 || ![0,1,2].includes(kind) || !Number.isSafeInteger(actions) || actions < 0 || actions > (config.rulesVersion >= 13 ? 127 : 63) || (actions & 48) === 48
      || ![0,1].includes(repath) || (repath && kind !== 2) || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid input packet');
    if ((actions & 2) && !dashEnabled) throw new Error('Dash is not enabled for this attempt');
    if ((actions & 4) && !(config.rulesVersion >= 5)) throw new Error('Elder gifts are not enabled for this attempt');
    if ((actions & 56) && !(config.rulesVersion >= 9)) throw new Error('Magic characters are not enabled for this attempt');
    if (config.rulesVersion >= 13) {
      if (actions & 48) throw new Error('The character is locked for this attempt');
      if ((actions & 8) && config.character !== 'wizard') throw new Error('Only the wizard can cast magic');
      if ((actions & 64) && config.character !== 'robot') throw new Error('Only the robot can use EMP');
    }
    if (kind === 0 && (x !== 0 || y !== 0)) throw new Error('Invalid idle input');
    if (kind === 1 && Math.hypot(x, y) > 1.000000001) throw new Error('Invalid movement speed');
    if (kind === 2 && (x < 0 || x > WORLD.width || y < 0 || y > WORLD.height)) throw new Error('Invalid path target');
    totalTicks += ticks;
    if (totalTicks > MAX_TRACE_TICKS) throw new Error('Input trace is too long');
  }
  const simulation = createSimulation(config);
  const { player, run, expedition } = simulation;
  let simulatedTicks = 0;
  for (const [ticks, kind, x, y, actions, repath] of packets) {
    if (performance.now() > validationDeadline) throw new Error('Verification time limit exceeded');
    for (let index = 0; index < ticks; index++) {
      if (index % 600 === 0 && performance.now() > validationDeadline) throw new Error('Verification time limit exceeded');
      if (['won','failed'].includes(run.status)) throw new Error('Trace continues after the result');
      simulatedTicks++;
      stepSimulation(simulation, { kind, x, y, shield:index === 0 && Boolean(actions & 1), dash:index === 0 && Boolean(actions & 2), elder:index === 0 && Boolean(actions & 4), magic:index === 0 && Boolean(actions & 8), emp:index === 0 && Boolean(actions & 64), character:index === 0 ? actions & 16 ? 'wizard' : actions & 32 ? 'robot' : undefined : undefined, repath:index === 0 && Boolean(repath) });
    }
  }
  if (!['won','failed'].includes(run.status)) throw new Error(`The attempt is not finished (${run.collected}/${run.itemCount}, ${run.bonuses} bonus, position ${player.x},${player.y})`);
  return { ...run, simulationSeconds:simulatedTicks / 60, layoutName:expedition.layoutName,
    ...(simulation.emp ? { empUses:simulation.emp.uses } : {}),
    ...(simulation.magic ? { magicShots:simulation.magic.shots,magicHits:simulation.magic.hits,hunterDefeated:simulation.challenge.terrain.hunter?.state === 'defeated' } : {}) };
}
