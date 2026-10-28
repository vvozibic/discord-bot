import { createTerrain, advanceTerrain, terrainHazard, resolveTerrainDamage } from './terrain-hazards.js';
import { levelVariantFor } from './level-variants.js';

export const CHALLENGE_RULES_VERSION = 13;

export const MECHANICS = Object.freeze([
  Object.freeze({ key:'orderedCoins', name:'Numbered route', description:'Collect the six pulse coins in order. Plan your route around danger.' }),
  Object.freeze({ key:'pulseTraps', name:'Pulse traps', description:'Amber rings warn before a red pulse. Wait for the gap or use a shield.' }),
  Object.freeze({ key:'alarm', name:'Rising alarm', description:'Every pulse coin makes the patrols faster. The return trip is the hardest.' }),
  Object.freeze({ key:'armor', name:'Limited armor', description:'Three or four unshielded hits end the attempt, even with time remaining.' }),
  Object.freeze({ key:'exitWindow', name:'Extraction windows', description:'After the last coin, the gate opens for four seconds in every eight.' }),
  Object.freeze({ key:'lava', name:'Lava & heat', description:'Orange ground builds heat. Cross quickly and cool down before the meter fills.' }),
  Object.freeze({ key:'crumble', name:'Crumbling tiles', description:'Stepping on cracked ground starts a one-second warning before it collapses.' }),
  Object.freeze({ key:'lasers', name:'Sweeping lasers', description:'Bridge beams sweep across your route. Amber warns before a red beam fires.' }),
  Object.freeze({ key:'hunter', name:'Hunter drone', description:'The third pulse coin wakes a drone that follows your route around obstacles.' }),
  Object.freeze({ key:'dash', name:'Dash burst', description:'Short burst of speed through danger, then a 3.5-second recharge. Move + Shift or tap Dash.' }),
]);

export const DEFAULT_MECHANICS = Object.freeze(Object.fromEntries(MECHANICS.map(({ key }) => [key, true])));

/** Old issued tickets retain their original rules, even after a deployment. */
export function mechanicsFor(config = {}) {
  const version = config.rulesVersion;
  return Object.fromEntries(MECHANICS.map(({ key }, index) => [key,
    ([3,4,5,6,7,8,9,10,11,12,CHALLENGE_RULES_VERSION].includes(version) || (version === 2 && index < 5)) && config.mechanics?.[key] !== false]));
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function createChallenge(expedition, config = {}) {
  const mechanics = mechanicsFor(config), tier = Math.max(0, Math.min(5, config.tier ?? 0));
  const variant = levelVariantFor(config);
  const trapSites = expedition.items.filter((_, index) => index % 2 === 1);
  const traps = mechanics.pulseTraps ? trapSites.slice(0, variant?.id === 'pursuit' ? 1 : trapSites.length).map((point, index) => ({
    x:point.x, y:point.y, radius:23 + tier,
    period:5.8 - tier * .18,
    phase:hash(`${expedition.seed}:pulse:${index}`) / 4294967296 * 4,
    warningDuration:1.15, activeDuration:1.15,
  })) : [];
  return { mechanics, traps, terrain:createTerrain(expedition, { ...config, mechanics, tier }), clock:0, portalArmedAt:null };
}

export function advanceChallenge(challenge, run, dt, player) {
  if (challenge && run?.status === 'running' && Number.isFinite(dt) && dt > 0) {
    challenge.clock += dt;
    advanceTerrain(challenge.terrain, run, player, dt, challenge.clock);
  }
}

export function advancedHazard(challenge, player) { return terrainHazard(challenge?.terrain, player); }
export function resolveTerrainHit(challenge, hazard) { resolveTerrainDamage(challenge?.terrain, hazard); }

export function patrolClockRate(challenge, run) {
  return challenge?.mechanics?.alarm ? 1 + Math.min(run.collected, run.itemCount) * .11 : 1;
}

export function trapPhase(trap, clock) {
  if (trap.suppressedUntil !== undefined && clock < trap.suppressedUntil - 1e-9) return 'idle';
  const phase = ((clock + trap.phase) % trap.period + trap.period) % trap.period;
  if (phase >= trap.period - trap.activeDuration) return 'active';
  if (phase >= trap.period - trap.activeDuration - trap.warningDuration) return 'warning';
  return 'idle';
}

export function trapHits(challenge, player) {
  return Boolean(challenge?.mechanics?.pulseTraps && challenge.traps.some(trap =>
    trapPhase(trap, challenge.clock) === 'active' && Math.hypot(player.x - trap.x, player.y - trap.y) < trap.radius));
}

export function canCollectCoin(challenge, item, run) {
  return Boolean(item.bonus || !challenge?.mechanics?.orderedCoins || item.id === run.collected);
}

export function armExit(challenge, run) {
  if (challenge && run.collected >= run.itemCount && challenge.portalArmedAt === null) challenge.portalArmedAt = challenge.clock;
}

export function exitStatus(challenge, run) {
  if (!run || run.collected < run.itemCount) return { open:false, remaining:0 };
  if (!challenge?.mechanics?.exitWindow) return { open:true, remaining:0 };
  if (challenge.portalArmedAt === null) return { open:false, remaining:4 };
  const phase = ((challenge.clock - challenge.portalArmedAt) % 8 + 8) % 8;
  return phase < 4 ? { open:false, remaining:4 - phase } : { open:true, remaining:8 - phase };
}
