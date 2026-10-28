import { LAYOUTS } from './world.js';
import { CHALLENGE_RULES_VERSION } from './challenge-rules.js';

export const PROGRESS_KEY = 'forest-trail-progress-v1';
const MAP_IDS = LAYOUTS.map(layout => layout.id);
const FOREST_IDS = LAYOUTS.filter(layout => layout.theme === 'forest').map(layout => layout.id);
const LEGACY_SECOND_LEVEL = Object.freeze({ name:'Foundry patrol', timeLimit:180, enemies:['wisp','wisp'], speed:.9, shields:3 });
const LEGACY_FACTORY_NAMES = ['Quiet shift','Factory watch','Factory patrol','Hazard shift','Heavy patrol','Core alarm'];
const LEGACY_SETTINGS = [
  { name:'First steps', timeLimit:null, enemies:[], speed:1, shields:0 },
  { name:'Forest watch', timeLimit:null, enemies:['wisp'], speed:.85, shields:3 },
  { name:'On the move', timeLimit:150, enemies:['wisp','scout'], speed:.9, shields:3 },
  { name:'Wild trail', timeLimit:130, enemies:['sentinel','scout'], speed:1, shields:2 },
  { name:'Deep forest', timeLimit:115, enemies:['wisp','scout','sentinel'], speed:1.05, shields:2 },
  { name:'Storm frontier', timeLimit:100, enemies:['sentinel','scout','wisp','scout'], speed:1.1, shields:2 },
];
// Issued version-two tickets must keep these values and their original five mechanics.
const VERSION_TWO_SETTINGS = [
  { name:'Relay gauntlet', timeLimit:70, enemies:['wisp','scout'], speed:.95, shields:2, maxHits:4 },
  { name:'Pressure patrol', timeLimit:65, enemies:['wisp','scout'], speed:1.05, shields:2, maxHits:4 },
  { name:'Danger circuit', timeLimit:60, enemies:['wisp','scout','sentinel'], speed:1.12, shields:1, maxHits:3 },
  { name:'Alarm pursuit', timeLimit:55, enemies:['sentinel','scout','scout'], speed:1.2, shields:1, maxHits:3 },
  { name:'Critical route', timeLimit:50, enemies:['sentinel','scout','wisp','scout'], speed:1.3, shields:1, maxHits:3 },
  { name:'Overload frontier', timeLimit:45, enemies:['sentinel','scout','sentinel','scout'], speed:1.4, shields:1, maxHits:3 },
];
const SETTINGS = [
  { name:'Relay gauntlet', timeLimit:70, enemies:['wisp','scout'], speed:.95, shields:2, maxHits:4 },
  { name:'Pressure patrol', timeLimit:65, enemies:['wisp','scout'], speed:1.05, shields:2, maxHits:4 },
  { name:'Danger circuit', timeLimit:60, enemies:['wisp','scout','sentinel'], speed:1.12, shields:1, maxHits:3 },
  { name:'Alarm pursuit', timeLimit:55, enemies:['sentinel','scout','scout'], speed:1.2, shields:1, maxHits:3 },
  { name:'Critical route', timeLimit:50, enemies:['sentinel','scout','wisp','scout'], speed:1.3, shields:1, maxHits:3 },
  { name:'Overload frontier', timeLimit:45, enemies:['sentinel','scout','sentinel','scout'], speed:1.4, shields:1, maxHits:3 },
];
const VERSION_TWO_MECHANICS = Object.freeze({ orderedCoins:true, pulseTraps:true, alarm:true, armor:true, exitWindow:true });
const MECHANICS = Object.freeze({ ...VERSION_TWO_MECHANICS, lava:true, crumble:true, lasers:true, hunter:true, dash:true });
const LEVEL_TWO_GUARDS = Object.freeze(['wisp','scout','sentinel','scout']);

function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}
function storageDefault() { try { return globalThis.localStorage; } catch { return null; } }
function newSeed() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function variantFor(level) { return level % 2 ? 'pursuit' : 'machinery'; }
function validCharacter(value) { return value === 'wizard' || value === 'robot'; }
function fresh(seed) { return { version:1, seed, level:1, skill:0, streak:0, attempt:0, recentMaps:[], active:null }; }

function validProgress(value) {
  if (!value || value.version !== 1 || typeof value.seed !== 'string' || !value.seed.length || value.seed.length > 80
    || !integer(value.level, 1, 1000000) || !integer(value.skill, 0, 5) || !integer(value.streak, 0, 1000000)
    || !integer(value.attempt, 0, 1000000) || !Array.isArray(value.recentMaps) || value.recentMaps.length > 2
    || !value.recentMaps.every(id => MAP_IDS.includes(id))) return false;
  const active = value.active;
  if (active === null) return true;
  return active && MAP_IDS.includes(active.layoutId) && integer(active.level, 1, 1000000)
    && integer(active.tier, 0, 5) && integer(active.attempt, 0, 1000000)
    && (active.rulesVersion === undefined || [1,2,3,4,5,6,7,8,9,10,11,12,CHALLENGE_RULES_VERSION].includes(active.rulesVersion))
    && (!(active.rulesVersion >= 13) || validCharacter(active.character) && active.variant === variantFor(active.level))
    && ['ready','won','failed'].includes(active.status)
    && active.level === value.level - Number(active.status === 'won')
    && active.tier <= Math.min(5, active.level - 1);
}

function configFor(state, plan) {
  const rulesVersion = plan.rulesVersion ?? 1, legacy = rulesVersion === 1;
  const setting = legacy ? (plan.level === 2 && plan.layoutId === 'rustworks' && plan.attempt === 0
    ? LEGACY_SECOND_LEVEL : LEGACY_SETTINGS[plan.tier]) : (rulesVersion === 2 ? VERSION_TWO_SETTINGS : SETTINGS)[plan.tier];
  const seed = `${state.seed}:level:${plan.level}`;
  // Outstanding old runs keep their exact challenge; new retries retain every mechanic.
  const extraTime = Math.min(legacy ? 30 : 10, plan.attempt * 10);
  return {
    id:`${seed}:attempt:${plan.attempt}${legacy ? (plan.level === 2 && plan.layoutId === 'rustworks' ? ':rustworks-v1' : '') : `:hard-v${rulesVersion}`}${rulesVersion >= 13 ? `:${plan.variant}:${plan.character}` : ''}`, seed, layoutId:plan.layoutId,
    level:plan.level, tier:plan.tier, attempt:plan.attempt,
    rulesVersion,
    ...(rulesVersion >= 13 ? { character:plan.character, variant:plan.variant } : {}),
    challengeName:legacy ? (setting === LEGACY_SECOND_LEVEL ? setting.name : plan.layoutId === 'rustworks' ? LEGACY_FACTORY_NAMES[plan.tier] : setting.name)
      : `${plan.layoutId === 'rustworks' ? 'Rustworks' : 'Hard trail'} · ${setting.name}`,
    mode:setting.enemies.length ? 'storm' : 'journey', scope:'all',
    enemies:[...(rulesVersion >= 10 && plan.level === 2 ? LEVEL_TWO_GUARDS : setting.enemies)], patrolSpeed:setting.speed,
    timeLimit:setting.timeLimit === null ? null : setting.timeLimit + extraTime,
    // Retry assistance extends survival time, never the ranked speed bonus.
    ...(rulesVersion >= 12 ? { scoreTimeLimit:setting.timeLimit } : {}),
    shieldCharges:rulesVersion >= 5 ? 1 : setting.shields + Number(legacy && plan.attempt > 0 && setting.enemies.length > 0),
    ...(!legacy ? { maxHits:setting.maxHits, mechanics:{ ...(rulesVersion === 2 ? VERSION_TWO_MECHANICS : MECHANICS) } } : {}),
  };
}

/** Deterministic hard progression; pending legacy attempts remain replayable until replaced. */
export function createLevelDirector({ storage = storageDefault(), seed = newSeed() } = {}) {
  let state = fresh(seed);
  let available = Boolean(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');
  if (available) {
    try {
      const payload = JSON.parse(storage.getItem(PROGRESS_KEY) ?? 'null');
      if (validProgress(payload)) state = payload;
    } catch { /* Invalid saves start a fresh trail; denied storage falls back below. */ }
  }
  function persist() {
    if (available) try { storage.setItem(PROGRESS_KEY, JSON.stringify(state)); } catch { available = false; }
  }
  function current({ upgrade = false, character } = {}) {
    if (character !== undefined && !validCharacter(character)) throw new RangeError('Choose the wizard or robot.');
    // Only a new attempt request may replace a legacy plan; result checks must not mutate it.
    if (upgrade && state.active?.status === 'ready' && (state.active.rulesVersion ?? 1) < CHALLENGE_RULES_VERSION) {
      const legacy = (state.active.rulesVersion ?? 1) === 1;
      state.active.rulesVersion = CHALLENGE_RULES_VERSION;
      if (CHALLENGE_RULES_VERSION >= 13) {
        state.active.character = character ?? 'wizard';
        state.active.variant = variantFor(state.active.level);
      }
      if (legacy) {
        state.active.tier = Math.min(5, state.level - 1);
        if (state.level === 2) state.active.layoutId = 'rustworks';
      }
      persist();
    }
    if (state.active?.status !== 'ready') {
      const retryMap = state.active?.status === 'failed' ? state.active.layoutId : null;
      const pool = state.level === 1 ? FOREST_IDS : MAP_IDS;
      const candidates = pool.filter(id => !state.recentMaps.includes(id));
      const layoutId = retryMap ?? (state.level === 2 ? 'rustworks' : candidates[hash(`${state.seed}:${state.level}`) % candidates.length]);
      state.active = {
        level:state.level, layoutId, tier:Math.min(5, state.level - 1),
        attempt:state.attempt, status:'ready', rulesVersion:CHALLENGE_RULES_VERSION,
        ...(CHALLENGE_RULES_VERSION >= 13 ? { character:character ?? 'wizard', variant:variantFor(state.level) } : {}),
      };
      persist();
    }
    // Callers bind a character only when issuing a new ticket. Reading/resuming
    // the current plan never changes an already selected hero.
    if (state.active.rulesVersion >= 13 && character !== undefined && state.active.character !== character) {
      state.active.character = character;
      persist();
    }
    return configFor(state, state.active);
  }
  function complete(config, run) {
    if (!state.active || state.active.status !== 'ready' || !['won','failed'].includes(run?.status)
      || config?.id !== configFor(state, state.active).id
      || state.active.rulesVersion >= 13 && (config.character !== state.active.character || config.variant !== state.active.variant)) return false;
    state.active.status = run.status;
    if (run.status === 'won') {
      const comfortable = run.hits <= 1 && run.elapsed <= (run.timeLimit === null ? 120 : run.timeLimit * .8);
      state.skill = Math.max(0, Math.min(5, Math.max(state.skill, state.active.tier) + (comfortable ? 1 : run.hits >= 3 ? -1 : 0)));
      state.streak = Math.min(1000000, state.streak + 1);
      state.recentMaps = [...state.recentMaps, state.active.layoutId].slice(-2);
      state.level = Math.min(1000000, state.level + 1);
      state.attempt = 0;
    } else {
      state.skill = Math.max(0, state.skill - 1);
      state.streak = 0;
      state.attempt = Math.min(1000000, state.attempt + 1);
    }
    persist();
    return true;
  }
  return { current, complete, get available() { return available; } };
}

export function describeLevel(config) {
  const enemies = config.enemies.length;
  const armor = config.maxHits && config.mechanics?.armor !== false;
  return `${enemies ? `${enemies} ${enemies === 1 ? 'patrol' : 'patrols'} · ${config.shieldCharges} ${config.shieldCharges === 1 ? 'shield' : 'shields'}${config.rulesVersion >= 5 ? ' from elder' : ''}` : 'A peaceful trail'}${armor ? ` · ${config.maxHits}-hit limit` : ''} · ${config.timeLimit === null ? 'no time limit' : `${config.timeLimit} seconds`}`;
}
