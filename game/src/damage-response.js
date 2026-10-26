import { PLAYER_SPEED, movePlayer } from './world.js';
import { trapPhase } from './challenge-rules.js';

export const IMPACT_DURATION = .22;
export const IMPACT_SPEED = 150;
export const DAMAGE_STAGGER_DURATION = .18;

/** Locate the actual contact, including a beam's closest point and an active pulse. */
export function impactDirection(player, hazard, challenge) {
  let source = hazard;
  if (hazard?.type === 'trap') {
    source = challenge?.traps?.filter(trap => trapPhase(trap, challenge.clock) === 'active'
      && Math.hypot(player.x - trap.x, player.y - trap.y) < trap.radius)
      .sort((a, b) => Math.hypot(player.x - a.x, player.y - a.y) - Math.hypot(player.x - b.x, player.y - b.y))[0];
  } else if (hazard?.type === 'laser') {
    source = { x:Math.max(Math.min(hazard.x1, hazard.x2), Math.min(Math.max(hazard.x1, hazard.x2), player.x)), y:hazard.y };
  }
  const dx = player.x - source?.x, dy = player.y - source?.y;
  const distance = Math.hypot(dx, dy);
  if (Number.isFinite(distance) && distance > 1e-9) return { x:dx / distance, y:dy / distance };
  // An exact overlap has no geometric normal. Recoil against the last facing,
  // using a fixed fallback rather than randomness so ranked replay stays exact.
  const fallback = { right:{ x:-1, y:0 }, left:{ x:1, y:0 }, up:{ x:0, y:1 }, down:{ x:0, y:-1 } };
  return { ...(fallback[player.facing] ?? { x:0, y:-1 }) };
}

export function createImpact(player, hazard, challenge) {
  return { remaining:IMPACT_DURATION, total:IMPACT_DURATION,
    direction:impactDirection(player, hazard, challenge), sourceType:hazard?.type ?? 'hazard' };
}

/** A short decelerating impulse, integrated exactly and clipped by world collisions. */
export function advanceImpact(simulation, dt) {
  const impact = simulation.impact;
  if (!impact || impact.remaining <= 0 || !Number.isFinite(dt) || dt <= 0) return false;
  const remaining = Math.max(0, impact.remaining - dt);
  const distance = IMPACT_SPEED * (impact.remaining ** 2 - remaining ** 2) / (2 * impact.total);
  impact.remaining = remaining;
  // Two-pixel steps prevent an impulse from jumping through a narrow solid or
  // the water edge even when a caller catches up with a large time interval.
  const steps = Math.max(1, Math.ceil(distance / 2)), { player } = simulation;
  const facing = player.facing;
  let moved = false;
  for (let index = 0; index < steps; index++) {
    moved = movePlayer(player, impact.direction.x, impact.direction.y, distance / steps / PLAYER_SPEED) || moved;
  }
  player.facing = facing;
  return moved;
}
