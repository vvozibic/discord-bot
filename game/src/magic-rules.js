import { clearMagicSegment } from './world.js';
import { interruptHunterDash } from './hunter-ai.js';

export const MAGIC_COOLDOWN = 2;
export const MAGIC_RANGE = 260;
export const MAGIC_CAST_DURATION = .36;
const WINDUP = .12;
const BOLT_SPEED = 400;
const BOLT_LIFETIME = .85;
const STUN_DURATION = 1;

export function createMagic(config = {}) {
  return { character:config.rulesVersion >= 13 && config.character !== 'robot' ? 'wizard' : 'robot', cooldown:0, castRemaining:0, windup:0, castFacing:'down', projectile:null, impact:null, shots:0, hits:0,
    ...(config.rulesVersion >= 11 ? { attackCooldown:MAGIC_COOLDOWN } : {}) };
}

export function setMagicCharacter(simulation, character) {
  if (simulation?.config?.rulesVersion >= 13) return false;
  if (!simulation?.magic || !['wizard','robot'].includes(character) || !['ready','running'].includes(simulation.run.status)) return false;
  simulation.magic.character = character;
  return true;
}

export function staffOrigin(player, facing = player.facing) {
  return { x:player.x + (facing === 'left' ? -18 : 18), y:player.y - 3 };
}

export function magicStatus(simulation) {
  const magic = simulation?.magic, hunter = simulation?.challenge.terrain?.hunter;
  if (!magic || magic.character !== 'wizard') return { ready:false, label:'Wizard only' };
  if (simulation.run.status !== 'running') return { ready:false, label:simulation.run.status === 'ready' ? 'Move first' : 'Finished' };
  if (magic.cooldown > 0) return { ready:false, label:`${magic.cooldown.toFixed(1)}s` };
  if (!hunter || hunter.state === 'sleeping') return { ready:false, label:`Coin ${hunter?.wakeAt ?? 3}` };
  if (hunter.state === 'defeated') return { ready:false, label:'Defeated' };
  if (simulation.run.staggerRemaining > 0) return { ready:false, label:'Staggered' };
  const { player } = simulation, distance = Math.hypot(hunter.x - player.x, hunter.y - player.y);
  if (distance > MAGIC_RANGE) return { ready:false, label:'Too far' };
  const dx = hunter.x - player.x, dy = hunter.y - player.y;
  const facing = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down';
  if (!clearMagicSegment(staffOrigin(player,facing),hunter)) return { ready:false, label:'Blocked' };
  return { ready:true, label:'Ready', facing };
}

export function castMagic(simulation) {
  const status = magicStatus(simulation);
  if (!status.ready) return false;
  const { magic } = simulation;
  magic.cooldown = magic.attackCooldown ?? 3;
  magic.castRemaining = MAGIC_CAST_DURATION;
  magic.windup = WINDUP;
  magic.castFacing = status.facing;
  magic.shots++;
  return true;
}

/** Fixed-step projectile flight, shared by the browser and ranked verifier. */
export function advanceMagic(simulation, dt) {
  const { magic, run } = simulation;
  const events = [];
  if (!magic || run.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return events;
  magic.cooldown = Math.max(0,magic.cooldown - dt);
  magic.castRemaining = Math.max(0,magic.castRemaining - dt);
  if (magic.impact) {
    magic.impact.remaining -= dt;
    if (magic.impact.remaining <= 0) magic.impact = null;
  }
  let travelTime = dt;
  if (magic.windup > 0) {
    travelTime = Math.max(0,dt - magic.windup);
    magic.windup = Math.max(0,magic.windup - dt);
    if (magic.windup <= 1e-9) {
      magic.windup = 0;
      const origin = staffOrigin(simulation.player,magic.castFacing);
      magic.projectile = { ...origin, previousX:origin.x, previousY:origin.y, remaining:BOLT_LIFETIME };
    }
  }
  const bolt = magic.projectile, hunter = simulation.challenge.terrain?.hunter;
  if (!bolt) return events;
  if (!hunter || hunter.state === 'defeated') { magic.projectile = null; return events; }
  bolt.previousX = bolt.x; bolt.previousY = bolt.y;
  let remaining = Math.min(travelTime,bolt.remaining);
  bolt.remaining = Math.max(0,bolt.remaining - travelTime);
  // Small segments cannot tunnel through a wall or the hunter during catch-up.
  while (remaining > 1e-9) {
    const step = Math.min(remaining,.01), dx = hunter.x - bolt.x, dy = hunter.y - bolt.y;
    const distance = Math.hypot(dx,dy), amount = Math.min(distance,BOLT_SPEED * step);
    const next = { x:bolt.x + (distance ? dx / distance * amount : 0), y:bolt.y + (distance ? dy / distance * amount : 0) };
    if (!clearMagicSegment(bolt,next)) {
      magic.impact = { x:bolt.x,y:bolt.y,remaining:.3,total:.3,blocked:true };
      magic.projectile = null; events.push({ type:'magic-blocked' }); return events;
    }
    bolt.x = next.x; bolt.y = next.y; remaining -= step;
    if (Math.hypot(bolt.x - hunter.x,bolt.y - hunter.y) <= hunter.radius + 4) {
      hunter.health = Math.max(0,hunter.health - 1);
      hunter.stunRemaining = STUN_DURATION;
      interruptHunterDash(hunter);
      hunter.path = []; hunter.repathRemaining = 0;
      if (!hunter.health) hunter.state = 'defeated';
      magic.hits++;
      magic.impact = { x:hunter.x,y:hunter.y,remaining:.5,total:.5,defeated:hunter.state === 'defeated' };
      magic.projectile = null;
      events.push({ type:'magic-hit',defeated:hunter.state === 'defeated',health:hunter.health });
      return events;
    }
  }
  if (bolt.remaining <= 0) magic.projectile = null;
  return events;
}
