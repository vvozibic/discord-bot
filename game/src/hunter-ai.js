import { PLAYER_SPEED, WORLD, canStand, clearSegment, findPath, followPath } from './world.js';

export const HUNTER_DASH_WARNING = .55;
export const HUNTER_DASH_DURATION = .32;
export const HUNTER_DASH_SPEED = 330;
export const HUNTER_DASH_COOLDOWN = 5.5;
const RECOVERY = .4;

export function createHunterAI() {
  return { smart:true, playerSample:null, velocity:{ x:0,y:0 }, target:null, intercepting:false,
    dashPhase:'ready', dashCooldown:2.5, dashWarning:0, dashRemaining:0, recovery:0,
    dashTarget:null, dashDirection:{ x:0,y:0 }, dashes:0, stalledFor:0 };
}

export function sampleHunterPlayer(hunter, player, dt) {
  if (hunter.playerSample) {
    const dx = (player.x - hunter.playerSample.x) / dt, dy = (player.y - hunter.playerSample.y) / dt;
    const speed = Math.hypot(dx,dy), scale = speed ? Math.min(1,PLAYER_SPEED * 2.3 / speed) : 0;
    const smoothing = 1 - Math.exp(-dt * 12);
    hunter.velocity.x += (dx * scale - hunter.velocity.x) * smoothing;
    hunter.velocity.y += (dy * scale - hunter.velocity.y) * smoothing;
  }
  hunter.playerSample = { x:player.x,y:player.y };
}

function predictedTarget(hunter, player, seconds) {
  if (hunter.stalledFor < .25) for (const fraction of [1,.5,.25]) {
    const point = { x:Math.max(29,Math.min(WORLD.width - 29,player.x + hunter.velocity.x * seconds * fraction)),
      y:Math.max(27,Math.min(WORLD.height - 27,player.y + hunter.velocity.y * seconds * fraction)) };
    if (canStand(point.x,point.y) && clearSegment(player,point)) return point;
  }
  return { x:player.x,y:player.y };
}

function planPursuit(hunter, player) {
  const distance = Math.hypot(player.x - hunter.x,player.y - hunter.y);
  const ahead = predictedTarget(hunter,player,Math.min(.8,Math.max(.2,distance / (hunter.speed + PLAYER_SPEED))));
  let path = findPath(hunter,ahead), target = ahead;
  if (!path.length) { path = findPath(hunter,player); target = { x:player.x,y:player.y }; }
  hunter.target = target;
  hunter.intercepting = Math.hypot(target.x - player.x,target.y - player.y) > 10;
  hunter.path = path;
  hunter.repathRemaining = distance < 100 ? .12 : .22;
}

function prepareDash(hunter, player) {
  const distance = Math.hypot(player.x - hunter.x,player.y - hunter.y);
  if (hunter.dashCooldown > 0 || distance < 70 || distance > 320) return;
  let aim = predictedTarget(hunter,player,.55);
  // In dense terrain, sprint along a clear route segment toward the next corner.
  if (!clearSegment(hunter,aim)) aim = hunter.path[0] ?? player;
  const dx = aim.x - hunter.x, dy = aim.y - hunter.y;
  const length = Math.hypot(dx,dy);
  if (length < 55) return;
  const travel = Math.min(HUNTER_DASH_SPEED * HUNTER_DASH_DURATION,length);
  const target = { x:hunter.x + dx / length * travel,y:hunter.y + dy / length * travel };
  if (!clearSegment(hunter,target)) return;
  // Commit the direction before the warning: the player can sidestep the line.
  hunter.dashTarget = target;
  hunter.dashDirection = { x:dx / length,y:dy / length };
  hunter.dashPhase = 'windup';
  hunter.dashWarning = HUNTER_DASH_WARNING;
  hunter.dashCooldown = HUNTER_DASH_COOLDOWN;
  hunter.path = [];
}

export function interruptHunterDash(hunter) {
  if (!hunter?.smart) return;
  hunter.dashPhase = 'ready'; hunter.dashWarning = 0; hunter.dashRemaining = 0; hunter.recovery = 0;
  hunter.dashTarget = null; hunter.path = []; hunter.repathRemaining = 0;
  hunter.dashCooldown = Math.max(2,hunter.dashCooldown);
}

/** Small continuous steps preserve collision and speed during dash/catch-up. */
export function advanceSmartHunter(hunter, player, dt) {
  let remaining = dt;
  while (remaining > 1e-9) {
    const step = Math.min(remaining,.01); remaining -= step;
    hunter.dashCooldown = Math.max(0,hunter.dashCooldown - step);
    if (hunter.dashPhase === 'windup') {
      hunter.dashWarning = Math.max(0,hunter.dashWarning - step);
      if (hunter.dashWarning <= 1e-9) {
        hunter.dashPhase = 'charge'; hunter.dashRemaining = HUNTER_DASH_DURATION;
        hunter.path = [{ ...hunter.dashTarget }]; hunter.dashes++;
      }
      continue;
    }
    if (hunter.dashPhase === 'charge') {
      const travelTime = Math.min(step,hunter.dashRemaining);
      followPath(hunter,hunter.path,travelTime * HUNTER_DASH_SPEED / PLAYER_SPEED);
      hunter.dashRemaining = Math.max(0,hunter.dashRemaining - step);
      if (hunter.dashRemaining <= 1e-9 || !hunter.path.length) {
        hunter.dashPhase = 'recover'; hunter.recovery = RECOVERY; hunter.path = [];
      }
      continue;
    }
    if (hunter.dashPhase === 'recover') {
      hunter.recovery = Math.max(0,hunter.recovery - step);
      if (hunter.recovery <= 1e-9) { hunter.dashPhase = 'ready'; hunter.dashTarget = null; hunter.repathRemaining = 0; }
      continue;
    }
    hunter.repathRemaining -= step;
    if (hunter.repathRemaining <= 1e-9 || !hunter.path.length) {
      planPursuit(hunter,player); prepareDash(hunter,player);
      if (hunter.dashPhase === 'windup') continue;
    }
    const before = { x:hunter.x,y:hunter.y };
    followPath(hunter,hunter.path,step * hunter.speed / PLAYER_SPEED);
    const moved = Math.hypot(hunter.x - before.x,hunter.y - before.y);
    hunter.stalledFor = moved < hunter.speed * step * .15 && Math.hypot(hunter.x - player.x,hunter.y - player.y) > 20
      ? hunter.stalledFor + step : 0;
    if (hunter.stalledFor >= .25) hunter.repathRemaining = 0;
  }
}
