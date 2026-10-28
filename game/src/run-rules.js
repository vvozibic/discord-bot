import { mechanicsFor } from './challenge-rules.js';
import { DAMAGE_STAGGER_DURATION } from './damage-response.js';
import { GUARDIAN } from './world.js';

export const MODES = Object.freeze([
  Object.freeze({
    id: 'journey',
    name: 'Journey',
    description: 'Explore at your own pace. Take a detour for bonus coins.',
    timeLimit: null,
  }),
  Object.freeze({
    id: 'storm',
    name: 'Storm',
    description: 'Escape in 90 seconds. Dodge wisps and ask the elder for a shield.',
    timeLimit: 90,
  }),
]);

const CORE_POINTS = 100;
const BONUS_POINTS = 200;
const COMPLETION_POINTS = 300;
const SHIELD_DURATION = 3;
const HIT_COOLDOWN = 2;
const HIT_PENALTY_SECONDS = 8;
const DASH_DURATION = .18;
const DASH_COOLDOWN = 3.5;
const DASH_MULTIPLIER = 2.3;

function count(value, minimum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 1000) {
    throw new RangeError(`${name} must be an integer between ${minimum} and 1000`);
  }
  return value;
}

export function createRun(config = {}) {
  const { mode = 'journey', itemCount = 6, bonusCount = 2, timeLimit, shieldCharges = 2 } = config;
  const definition = MODES.find(candidate => candidate.id === mode);
  if (!definition) throw new RangeError(`Unknown run mode: ${mode}`);
  const deadline = timeLimit === undefined ? definition.timeLimit : timeLimit;
  if (deadline !== null && (!Number.isFinite(deadline) || deadline < 30 || deadline > 600)) throw new RangeError('Invalid run deadline');
  const scoreDeadline = config.scoreTimeLimit === undefined ? deadline : config.scoreTimeLimit;
  if (config.rulesVersion >= 12 && (deadline === null ? scoreDeadline !== null
    : !Number.isFinite(scoreDeadline) || scoreDeadline < 30 || scoreDeadline > deadline)) throw new RangeError('Invalid scoring deadline');
  const mechanics = mechanicsFor(config);
  const maxHits = mechanics.armor ? count(config.maxHits ?? 4, 1, 'maxHits') : null;
  return {
    mode,
    ...(config.rulesVersion >= 4 ? { damageResponseEnabled:true, staggerRemaining:0 } : {}),
    ...(config.rulesVersion >= 5 ? { shieldRequiresElder:true, elderGiftClaimed:false } : {}),
    ...(config.rulesVersion >= 10 ? { dashUses:0 } : {}),
    itemCount: count(itemCount, 1, 'itemCount'),
    bonusCount: count(bonusCount, 0, 'bonusCount'),
    started: false,
    elapsed: 0,
    collected: 0,
    bonuses: 0,
    hits: 0,
    maxHits,
    failureReason:null,
    score: 0,
    status: 'ready',
    shieldCharges: config.rulesVersion >= 5 ? 0 : count(shieldCharges, 0, 'shieldCharges'),
    shieldRemaining: 0,
    dashEnabled:Boolean(mechanics.dash),
    dashRemaining:0,
    dashCooldown:0,
    hitCooldown: 0,
    timeLimit: deadline,
    ...(config.rulesVersion >= 12 ? { scoreTimeLimit:scoreDeadline } : {}),
  };
}

function running(run) {
  return run?.started === true && run.status === 'running';
}

function expireRun(run) {
  if (run.timeLimit !== null && run.elapsed >= run.timeLimit) {
    run.status = 'failed';
    run.failureReason = 'time';
    run.shieldRemaining = 0;
    run.dashRemaining = 0;
  }
}

export function startRun(run) {
  if (!run || run.started || run.status !== 'ready') return false;
  run.started = true;
  run.status = 'running';
  return true;
}

export function advanceRun(run, dt) {
  if (!running(run) || !Number.isFinite(dt) || dt <= 0) return run?.status;
  run.elapsed += dt;
  run.shieldRemaining = Math.max(0, run.shieldRemaining - dt);
  run.hitCooldown = Math.max(0, run.hitCooldown - dt);
  run.dashRemaining = Math.max(0, run.dashRemaining - dt);
  run.dashCooldown = Math.max(0, run.dashCooldown - dt);
  if (run.damageResponseEnabled) run.staggerRemaining = Math.max(0, run.staggerRemaining - dt);
  expireRun(run);
  return run.status;
}

export function collectCore(run) {
  if (!running(run) || run.collected >= run.itemCount) return false;
  run.collected += 1;
  run.score += CORE_POINTS;
  return true;
}

export function collectBonus(run) {
  if (!running(run) || run.bonuses >= run.bonusCount) return false;
  run.bonuses += 1;
  run.score += BONUS_POINTS;
  return true;
}

export function claimElderShield(run, player) {
  if (!run?.shieldRequiresElder || run.elderGiftClaimed || !['ready','running'].includes(run.status)
    || !player || !Number.isFinite(player.x) || !Number.isFinite(player.y)
    || Math.hypot(player.x - GUARDIAN.x, player.y - GUARDIAN.y) > 45) return false;
  run.elderGiftClaimed = true;
  run.shieldCharges = 1;
  return true;
}

export function activateShield(run) {
  if (run?.shieldRequiresElder && !run.elderGiftClaimed) return false;
  if (!running(run) || run.mode !== 'storm' || run.shieldCharges <= 0 || run.shieldRemaining > 0) return false;
  run.shieldCharges -= 1;
  run.shieldRemaining = SHIELD_DURATION;
  return true;
}

export function activateDash(run) {
  if (!running(run) || !run.dashEnabled || run.dashCooldown > 0 || (run.damageResponseEnabled && run.staggerRemaining > 0)) return false;
  run.dashRemaining = DASH_DURATION;
  run.dashCooldown = getNextDashCooldown(run);
  if (run.dashUses !== undefined) run.dashUses++;
  return true;
}

export function getNextDashCooldown(run) {
  return run?.dashUses >= 2 ? 6.5 : run?.dashUses === 1 ? 5 : DASH_COOLDOWN;
}

export function movementMultiplier(run) {
  return run?.dashEnabled && run.dashRemaining > 0 ? DASH_MULTIPLIER : 1;
}

export function hitHazard(run) {
  if (!running(run) || run.mode !== 'storm' || run.shieldRemaining > 0 || run.hitCooldown > 0) return false;
  run.hits += 1;
  run.score = Math.max(0, run.score - CORE_POINTS);
  run.elapsed += HIT_PENALTY_SECONDS;
  run.hitCooldown = HIT_COOLDOWN;
  if (run.damageResponseEnabled) {
    run.staggerRemaining = DAMAGE_STAGGER_DURATION;
    run.dashRemaining = 0;
  }
  expireRun(run);
  if (run.maxHits !== null && run.hits >= run.maxHits) {
    run.status = 'failed';
    run.failureReason = 'armor';
    run.shieldRemaining = 0;
    run.dashRemaining = 0;
  }
  return true;
}

export function finishRun(run) {
  if (!running(run) || run.collected < run.itemCount) return false;
  expireRun(run);
  if (!running(run)) return false;
  run.status = 'won';
  run.shieldRemaining = 0;
  run.dashRemaining = 0;
  run.score += COMPLETION_POINTS;
  if (run.mode === 'storm' && run.timeLimit !== null) run.score += Math.floor(Math.max(0, (run.scoreTimeLimit ?? run.timeLimit) - run.elapsed)) * 5;
  return true;
}

export function getRemainingTime(run) {
  return run?.timeLimit === null ? null : Math.max(0, (run?.timeLimit ?? 0) - (run?.elapsed ?? 0));
}
