import { BRIDGE, SPAWN, PORTAL, PLAYER_SPEED, canStand, clearSegment, findPath, followPath } from './world.js';
import { createHunterAI, sampleHunterPlayer, advanceSmartHunter } from './hunter-ai.js';

const PLAYER_RADIUS = 5;
const LEGACY_HEAT_RATE = 1 / 1.3;
const VERSION_SIX_HEAT_RATE = 1 / .65;
const HEAT_RATE = VERSION_SIX_HEAT_RATE * 1.3;
const COOL_RATE = 1.1;
const LASER_PERIOD = 5.2;

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function inCircle(player, area) {
  return Math.hypot(player.x - area.x, player.y - area.y) <= area.radius + PLAYER_RADIUS;
}

export function lavaContains(player, area) {
  return area.shape === 'square'
    ? Math.abs(player.x - area.x) <= area.radius + PLAYER_RADIUS && Math.abs(player.y - area.y) <= area.radius + PLAYER_RADIUS
    : inCircle(player, area);
}

function safeSite(point, radius) {
  return canStand(point.x, point.y)
    && Math.hypot(point.x - SPAWN.x, point.y - SPAWN.y) > radius + 36
    && Math.hypot(point.x - PORTAL.x, point.y - PORTAL.y) > radius + 36;
}

function crumbleSites(expedition) {
  const result = [], sources = [...expedition.bonuses, ...expedition.items];
  for (let index = 0; index < sources.length && result.length < 2; index++) {
    const source = sources[index], angle = hash(`${expedition.seed}:crumble:${index}`) / 4294967296 * Math.PI * 2;
    const candidates = Array.from({ length: 16 }, (_, turn) => ({
      x:source.x + Math.cos(angle + turn * Math.PI / 8) * 28,
      y:source.y + Math.sin(angle + turn * Math.PI / 8) * 28,
    }));
    candidates.push({ ...source });
    const point = candidates.find(candidate => safeSite(candidate, 22) && clearSegment(source, candidate)
      && result.every(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) > 54));
    if (point) result.push({ ...point, radius:22, state:'idle', remaining:0 });
  }
  return result;
}

/** Flags are already resolved by the caller, so legacy tickets cannot acquire new hazards. */
export function createTerrain(expedition, { mechanics = {}, tier = 0, rulesVersion } = {}) {
  const lava = mechanics.lava ? expedition.items.filter((_, index) => index % 2 === 0)
    .map(point => ({ x:point.x, y:point.y, radius:28, ...(rulesVersion >= 8 ? { shape:'square' } : {}) })) : [];
  const hunterSource = mechanics.hunter ? [...expedition.bonuses].sort((a, b) =>
    Math.hypot(b.x - SPAWN.x, b.y - SPAWN.y) - Math.hypot(a.x - SPAWN.x, a.y - SPAWN.y))[0] : null;
  return {
    lava, heat:0,
    ...(rulesVersion >= 6 && lava.length ? { heatRate:rulesVersion >= 7 ? HEAT_RATE : VERSION_SIX_HEAT_RATE } : {}),
    crumbles:mechanics.crumble ? crumbleSites(expedition) : [],
    lasers:mechanics.lasers ? [{ x1:BRIDGE.x - 8, x2:BRIDGE.x + BRIDGE.width + 8,
      y:BRIDGE.y + BRIDGE.height / 2, centerY:BRIDGE.y + BRIDGE.height / 2, state:'idle' }] : [],
    hunter:hunterSource ? { x:hunterSource.x, y:hunterSource.y, radius:14, state:'sleeping',
      ...(rulesVersion >= 9 ? { health:3,maxHealth:3,stunRemaining:0 } : {}),
      ...(rulesVersion >= 11 ? createHunterAI() : {}),
      remaining:0, path:[], repathRemaining:0, speed:65 + 6 * tier } : null,
  };
}

function advanceCrumble(area, player, dt) {
  if (area.state === 'idle') {
    if (!inCircle(player, area)) return;
    area.state = 'warning';
    area.remaining = 1;
  }
  // Consume the complete interval without losing time at warning/collapse boundaries.
  let elapsed = dt;
  while (area.state !== 'idle' && elapsed > 0) {
    const travel = Math.min(elapsed, area.remaining);
    area.remaining = Math.max(0, area.remaining - travel);
    elapsed -= travel;
    if (area.remaining > 1e-9) break;
    if (area.state === 'warning') { area.state = 'active'; area.remaining = 2.5; }
    else { area.state = 'idle'; area.remaining = 0; }
  }
}

function advanceHunter(hunter, run, player, dt) {
  if (!hunter || hunter.state === 'defeated') return;
  if (hunter.smart) sampleHunterPlayer(hunter,player,dt);
  if (hunter.state === 'sleeping') {
    if (run.collected < 3) return;
    hunter.state = 'warning';
    hunter.remaining = 1.5;
    return;
  }
  let elapsed = dt;
  if (hunter.stunRemaining > 0) {
    const stopped = Math.min(elapsed,hunter.stunRemaining);
    hunter.stunRemaining = Math.max(0,hunter.stunRemaining - elapsed);
    elapsed -= stopped;
    if (elapsed <= 1e-9) return;
  }
  if (hunter.state === 'warning') {
    const warning = Math.min(elapsed, hunter.remaining);
    hunter.remaining = Math.max(0, hunter.remaining - warning);
    elapsed -= warning;
    if (hunter.remaining > 1e-9) return;
    hunter.state = 'active';
    hunter.remaining = 0;
  }
  // The world movement helper caps individual movement. Small steps preserve speed
  // during replay catch-up, and every segment still uses the world's collisions.
  if (hunter.smart) { advanceSmartHunter(hunter,player,elapsed); return; }
  while (elapsed > 1e-9) {
    const step = Math.min(elapsed, .04);
    hunter.repathRemaining -= step;
    if (hunter.repathRemaining <= 1e-9) {
      hunter.path = findPath(hunter, player);
      hunter.repathRemaining = .45;
    }
    followPath(hunter, hunter.path, step * hunter.speed / PLAYER_SPEED);
    elapsed -= step;
  }
}

export function advanceTerrain(terrain, run, player, dt, clock) {
  if (!terrain || !player || run?.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
  if (terrain.lava.length) {
    const hot = terrain.lava.some(area => lavaContains(player, area));
    terrain.heat = Math.max(0, Math.min(1.5, terrain.heat + dt * (hot ? terrain.heatRate ?? LEGACY_HEAT_RATE : -COOL_RATE)));
  }
  for (const area of terrain.crumbles) advanceCrumble(area, player, dt);
  for (const laser of terrain.lasers) {
    const phase = ((clock % LASER_PERIOD) + LASER_PERIOD) % LASER_PERIOD;
    laser.y = laser.centerY + Math.sin(clock * .8) * 32;
    laser.state = phase < 3 ? 'idle' : phase < 4 ? 'warning' : 'active';
  }
  advanceHunter(terrain.hunter, run, player, dt);
}

export function terrainHazard(terrain, player) {
  if (!terrain || !player) return null;
  const lava = terrain.heat >= 1 - 1e-9 && terrain.lava.find(area => lavaContains(player, area));
  if (lava) return { type:'lava', ...lava };
  const crumble = terrain.crumbles.find(area => area.state === 'active' && inCircle(player, area));
  if (crumble) return { type:'crumble', ...crumble };
  const laser = terrain.lasers.find(beam => beam.state === 'active'
    && Math.hypot(player.x - Math.max(beam.x1, Math.min(beam.x2, player.x)), player.y - beam.y) <= 5);
  if (laser) return { type:'laser', ...laser };
  const hunter = terrain.hunter;
  if (hunter?.state === 'active' && !(hunter.stunRemaining > 0) && inCircle(player, hunter)) {
    return { type:'hunter', x:hunter.x, y:hunter.y, radius:hunter.radius };
  }
  return null;
}

export function resolveTerrainDamage(terrain, hazard) {
  if (terrain && hazard?.type === 'lava') terrain.heat = .35;
}
