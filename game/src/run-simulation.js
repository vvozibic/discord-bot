import { SPAWN, PORTAL, createExpedition, movePlayer, findPath, followPath } from './world.js';
import { createRun, startRun, advanceRun, collectCore, collectBonus, claimElderShield, activateShield, activateDash, movementMultiplier, hitHazard, finishRun } from './run-rules.js';
import { createPatrols, updatePatrols } from './enemy-rules.js';
import { createChallenge, advanceChallenge, patrolClockRate, trapHits, advancedHazard, resolveTerrainHit, canCollectCoin, armExit, exitStatus } from './challenge-rules.js';
import { createImpact, advanceImpact } from './damage-response.js';
import { createMagic, setMagicCharacter, castMagic, advanceMagic } from './magic-rules.js';
import { createEmp, activateEmp, advanceEmp } from './robot-abilities.js';

export function createSimulation(config) {
  const expedition = createExpedition(config.seed, { layoutId:config.layoutId, hazardCount:config.enemies.length });
  return {
    config, expedition,
    player:{ ...SPAWN, facing:'down', walking:false, walkClock:0, kind:'hero' },
    run:createRun(config),
    items:[...expedition.items.map(item => ({ ...item, bonus:false })), ...expedition.bonuses.map(item => ({ ...item, bonus:true }))]
      .map((item, id) => ({ ...item, id, collected:false, kind:'coin' })),
    hazards:createPatrols(expedition, config),
    challenge:createChallenge(expedition, config),
    path:[], target:null, clock:0,
    ...(config.rulesVersion >= 4 ? { impact:null, awaitingRepath:false } : {}),
    ...(config.rulesVersion >= 9 ? { magic:createMagic(config) } : {}),
    ...(config.rulesVersion >= 13 && config.character === 'robot' ? { emp:createEmp() } : {}),
  };
}

function damageEvent(simulation, hazard) {
  if (!simulation.run.damageResponseEnabled) return { type:'hit', hazard };
  simulation.impact = createImpact(simulation.player, hazard, simulation.challenge);
  simulation.path = [];
  simulation.target = null;
  simulation.awaitingRepath = true;
  simulation.player.walking = false;
  simulation.player.walkClock = 0;
  return { type:'hit', hazard, impact:{ ...simulation.impact.direction } };
}

/** The browser and ranked verifier use this same fixed-step gameplay order. */
export function stepSimulation(simulation, { kind = 0, x = 0, y = 0, repath = false, shield = false, dash = false, elder = false, magic = false, emp = false, character } = {}, dt = 1 / 60) {
  const { player, run, items, hazards, challenge } = simulation;
  const events = [];
  if (['won','failed'].includes(run.status) || !Number.isFinite(dt) || dt <= 0) return events;
  if (character) setMagicCharacter(simulation,character);
  if (magic && castMagic(simulation)) events.push({ type:'magic-cast' });
  if (emp && activateEmp(simulation)) events.push({ type:'emp' });
  if (elder && claimElderShield(run, player)) events.push({ type:'elder-shield' });
  if (shield) activateShield(run);
  if (dash) activateDash(run);
  if (kind !== 2) {
    simulation.path = []; simulation.target = null;
    if (run.damageResponseEnabled) simulation.awaitingRepath = false;
  }
  else if ((!simulation.awaitingRepath || repath) && (repath || !simulation.target || simulation.target.x !== x || simulation.target.y !== y)) {
    simulation.target = { x, y };
    simulation.path = findPath(player, simulation.target);
    if (run.damageResponseEnabled) simulation.awaitingRepath = false;
  }
  const power = kind === 1 ? Math.hypot(x, y) : 0;
  if (run.damageResponseEnabled) advanceImpact(simulation, dt);
  const movementTime = dt * movementMultiplier(run) * (run.damageResponseEnabled && run.staggerRemaining > 0 ? 0 : 1);
  player.walking = kind === 1 ? movePlayer(player, x, y, power * movementTime) : kind === 2 ? followPath(player, simulation.path, movementTime) : false;
  player.walkClock = player.walking ? player.walkClock + dt : 0;
  if (player.walking) startRun(run);
  if (run.status === 'running') simulation.clock += dt * patrolClockRate(challenge, run);
  advanceRun(run, dt);
  advanceChallenge(challenge, run, dt, player);
  advanceEmp(simulation, dt);
  events.push(...advanceMagic(simulation,dt));
  updatePatrols(hazards, simulation.clock);
  if (run.status === 'failed') return [{ type:'failed' }];
  if (run.status !== 'running') return events;
  for (const hazard of hazards) {
    if (Math.hypot(player.x - hazard.x, player.y - hazard.y) < hazard.radius && hitHazard(run)) events.push(damageEvent(simulation, hazard));
    if (run.status === 'failed') return [...events, { type:'failed' }];
  }
  if (trapHits(challenge, player) && hitHazard(run)) events.push(damageEvent(simulation, { type:'trap' }));
  if (run.status === 'failed') return [...events, { type:'failed' }];
  const terrainHazard = advancedHazard(challenge, player);
  if (terrainHazard && hitHazard(run)) {
    resolveTerrainHit(challenge, terrainHazard);
    events.push(damageEvent(simulation, terrainHazard));
  }
  if (run.status === 'failed') return [...events, { type:'failed' }];
  for (const item of items) {
    if (item.collected || Math.hypot(player.x - item.x, player.y - item.y) >= 13 || !canCollectCoin(challenge, item, run)) continue;
    item.collected = item.bonus ? collectBonus(run) : collectCore(run);
    if (item.collected) events.push({ type:item.bonus ? 'bonus' : 'core', item });
  }
  armExit(challenge, run);
  if (run.collected === run.itemCount && exitStatus(challenge, run).open
    && Math.hypot(player.x - PORTAL.x, player.y - PORTAL.y) < 15 && finishRun(run)) events.push({ type:'won' });
  return events;
}
