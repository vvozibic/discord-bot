import { SPAWN, PORTAL, GUARDIAN, createExpedition, findPath, followPath, clearSegment } from '../../src/world.js';
import { createRunTrace } from '../../src/run-trace.js';
import { createSimulation, stepSimulation } from '../../src/run-simulation.js';
import { trapPhase, exitStatus, patrolClockRate, advancedHazard } from '../../src/challenge-rules.js';
import { lavaContains } from '../../src/terrain-hazards.js';
import { setMagicCharacter, magicStatus } from '../../src/magic-rules.js';
import { empStatus } from '../../src/robot-abilities.js';

export function recordedVictory(config, { bonuses = true, repeatTarget = false } = {}) {
  if ([2,3,4,5,6,7,8,9,10,11,12,13].includes(config.rulesVersion)) return recordedHardVictory(config, { bonuses, repeatTarget });
  const expedition = createExpedition(config.seed, { layoutId:config.layoutId, hazardCount:config.enemies.length });
  const player = { ...SPAWN }, trace = createRunTrace();
  const goals = [...(bonuses ? expedition.bonuses : []), ...expedition.items, { ...PORTAL }];
  let ticks = 0;
  for (const [index, goal] of goals.entries()) {
    let path = findPath(player, goal);
    if (!path.length) throw new Error('Test route is unreachable');
    trace.repath();
    while (Math.hypot(player.x - goal.x, player.y - goal.y) >= 1) {
      if (!path.length) { path = findPath(player, goal); trace.repath(); if (!path.length) throw new Error('QA retry has no route'); }
      trace.step(2, goal.x, goal.y); followPath(player, path, 1 / 60);
      if (++ticks > 20000) throw new Error('Test route did not finish');
      if (repeatTarget && ticks % 121 === 0) { path = findPath(player, goal); trace.repath(); }
      if (index === goals.length - 1 && Math.hypot(player.x - PORTAL.x, player.y - PORTAL.y) < 15) break;
    }
    if (index < goals.length - 1 && Math.hypot(player.x - goal.x, player.y - goal.y) >= 13) throw new Error(`QA route stopped before ${goal.x},${goal.y} at ${player.x},${player.y}`);
  }
  return { trace:trace.snapshot(), seconds:ticks / 60 };
}

/** A real fixed-step playthrough: the verifier receives inputs, never edited game state. */
function recordedHardVictory(config, { bonuses, repeatTarget }) {
  // Optional detours can be too costly for a particular hazard layout. Alternate
  // real routes/departure timings; never change health, rules or player position.
  let lastError;
  const candidates = config.rulesVersion >= 3
    ? [{ bonuses, warmupTicks:0 }, { bonuses:false, warmupTicks:0 }, { bonuses:false, warmupTicks:30 }, { bonuses:false, warmupTicks:60 }]
    : [{ bonuses, warmupTicks:0 }];
  for (const candidate of candidates) {
    try { return hardAttempt(config, { ...candidate, repeatTarget }); }
    catch (error) { lastError = error; }
  }
  throw lastError;
}

function hardAttempt(config, { bonuses, repeatTarget, warmupTicks }) {
  const sim = createSimulation(config), trace = createRunTrace(), dt = 1 / 60;
  // Old runs selected their hero through an input. New tickets bind it before play.
  if (config.rulesVersion >= 11 && config.rulesVersion < 13) { setMagicCharacter(sim,'wizard'); trace.character('wizard'); }
  const bonusGoals = bonuses ? sim.items.filter(item => item.bonus) : [];
  bonusGoals.sort((a, b) => Math.hypot(a.x - sim.player.x, a.y - sim.player.y) - Math.hypot(b.x - sim.player.x, b.y - sim.player.y));
  const goals = [...(config.rulesVersion >= 5 ? [{ x:GUARDIAN.x, y:GUARDIAN.y + 25, elder:true }] : []), ...bonusGoals, ...sim.items.filter(item => !item.bonus), { ...PORTAL, portal:true }];
  let ticks = 0, index = 0, evade = null;
  while (!['won','failed'].includes(sim.run.status) && ticks < 12000) {
    if (ticks > 0 && ticks <= warmupTicks) {
      trace.step(0); stepSimulation(sim, { kind:0 }, dt); ticks++; continue;
    }
    while (goals[index]?.collected || goals[index]?.elder && sim.run.elderGiftClaimed) index++;
    let goal = goals[index];
    if (!goal) throw new Error('Hard test route exhausted its goals');
    if (goal.elder && Math.hypot(sim.player.x - GUARDIAN.x, sim.player.y - GUARDIAN.y) <= 44) {
      trace.elder(); trace.step(0); stepSimulation(sim, { elder:true }, dt); ticks++; continue;
    }
    if (evade && sim.challenge.clock < evade.until && Math.hypot(sim.player.x - evade.x, sim.player.y - evade.y) > 5
      && !(goal.portal && exitStatus(sim.challenge, sim.run).open)) goal = evade;
    else evade = null;
    const dash = config.rulesVersion >= 3 && sim.run.dashEnabled && sim.run.status === 'running'
      && sim.run.dashCooldown <= 0 && sim.run.dashRemaining <= 0;
    const path = !sim.target || sim.target.x !== goal.x || sim.target.y !== goal.y || !sim.path.length
      ? findPath(sim.player, goal) : sim.path.map(point => ({ ...point }));
    const projected = { ...sim.player };
    followPath(projected, path, dt * (dash || sim.run.dashRemaining > 0 ? 2.3 : 1));
    let wait = goal.portal && Math.hypot(sim.player.x - goal.x, sim.player.y - goal.y) < 14 && !exitStatus(sim.challenge, sim.run).open;
    // Stop outside a mine's ring until there is time to enter, collect and leave.
    wait ||= sim.challenge.traps.some(trap => Math.hypot(sim.player.x - trap.x, sim.player.y - trap.y) >= trap.radius + 4
      && Math.hypot(projected.x - trap.x, projected.y - trap.y) < trap.radius + 6
      && [0, .35, .7].some(ahead => trapPhase(trap, sim.challenge.clock + dt + ahead) !== 'idle'));
    const terrain = sim.challenge.terrain;
    wait ||= terrain?.crumbles.some(tile => tile.state === 'active'
      && Math.hypot(sim.player.x - tile.x, sim.player.y - tile.y) >= tile.radius + 7
      && Math.hypot(projected.x - tile.x, projected.y - tile.y) < tile.radius + 10);
    wait ||= terrain?.lasers.some(laser => laser.state !== 'idle' && projected.x >= laser.x1 - 6 && projected.x <= laser.x2 + 6
      && Math.abs(sim.player.y - laser.y) >= 20 && Math.abs(projected.y - laser.y) < 22);
    // Waiting is unsafe when the pursuer catches up. Make an actual short retreat
    // over a clear safe segment, then approach the objective again.
    const waitingThreat = wait && (terrain?.crumbles.find(tile => (tile.state === 'active' || tile.state === 'warning' && tile.remaining < .4)
      && Math.hypot(sim.player.x - tile.x, sim.player.y - tile.y) < tile.radius + 7)
      || (terrain?.heat > .75 && terrain.lava.find(tile => lavaContains(sim.player, tile)))
      || (terrain?.hunter?.state === 'active' && Math.hypot(sim.player.x - terrain.hunter.x, sim.player.y - terrain.hunter.y) < 80 && terrain.hunter));
    if (waitingThreat && sim.run.shieldRemaining <= 0) {
      const angle = Math.atan2(sim.player.y - waitingThreat.y, sim.player.x - waitingThreat.x);
      const candidates = [45,28].flatMap(radius => Array.from({ length:8 }, (_, turn) => ({
        x:sim.player.x + Math.cos(angle + turn * Math.PI / 4) * radius,
        y:sim.player.y + Math.sin(angle + turn * Math.PI / 4) * radius,
      }))).filter(point => clearSegment(sim.player, point) && !advancedHazard(sim.challenge, point)
        && !terrain.crumbles.some(tile => tile.state !== 'idle' && Math.hypot(point.x - tile.x, point.y - tile.y) < tile.radius + 7)
        && !sim.challenge.traps.some(trap => trapPhase(trap, sim.challenge.clock) !== 'idle'
          && Math.hypot(point.x - trap.x, point.y - trap.y) < trap.radius + 6));
      candidates.sort((a, b) => Math.hypot(b.x - waitingThreat.x, b.y - waitingThreat.y) - Math.hypot(a.x - waitingThreat.x, a.y - waitingThreat.y));
      if (candidates[0]) { evade = { ...candidates[0], until:sim.challenge.clock + .8 }; goal = evade; wait = false; }
    }
    const hunterDanger = terrain?.hunter?.state === 'active'
      && Math.hypot(projected.x - terrain.hunter.x, projected.y - terrain.hunter.y) < terrain.hunter.radius + 28;
    const danger = hunterDanger || terrain?.heat > .85 || sim.hazards.some(hazard => {
      for (const ahead of [0, .2, .4]) {
        const amount = (1 - Math.cos((sim.clock + ahead * patrolClockRate(sim.challenge, sim.run)) / hazard.period * Math.PI * 2 + hazard.phase)) / 2;
        const x = hazard.from.x + (hazard.to.x - hazard.from.x) * amount;
        const y = hazard.from.y + (hazard.to.y - hazard.from.y) * amount;
        if (Math.hypot(projected.x - x, projected.y - y) < hazard.radius + 14) return true;
      }
      return false;
    });
    const shield = danger && sim.run.shieldRemaining <= 0 && sim.run.shieldCharges > 0;
    const repath = !wait && (repeatTarget && ticks % 121 === 0 || !sim.path.length);
    const input = wait ? { kind:0, shield } : { kind:2, x:goal.x, y:goal.y, repath, shield, dash };
    if (config.rulesVersion >= 11 && magicStatus(sim).ready) { input.magic = true; trace.magic(); }
    if (config.rulesVersion >= 13 && empStatus(sim).ready
      && (danger || terrain?.lasers.some(laser => Math.hypot(sim.player.x - (laser.x1 + laser.x2) / 2, sim.player.y - laser.y) < 85)
        || sim.challenge.traps.some(trap => Math.hypot(sim.player.x - trap.x, sim.player.y - trap.y) < 85))) {
      input.emp = true; trace.emp();
    }
    if (input.shield) trace.shield();
    if (input.dash) trace.dash();
    if (input.repath) trace.repath();
    trace.step(input.kind, input.x, input.y);
    stepSimulation(sim, input, dt);
    ticks++;
  }
  if (sim.run.status !== 'won') throw new Error(`Hard QA route failed (${config.seed}, ${config.layoutId}, ${sim.run.failureReason}, ${sim.run.collected}/6, ${sim.run.hits} hits, ${sim.run.elapsed.toFixed(2)}s)`);
  return { trace:trace.snapshot(), seconds:ticks / 60 };
}
