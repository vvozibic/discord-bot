export const EMP_DURATION = 1.5;
export const EMP_COOLDOWN = 10;
export const EMP_RADIUS = 96;
export const ROBOT_HEAT_MULTIPLIER = .8;

export function createEmp() {
  return { cooldown:0, remaining:0, origin:null, radius:EMP_RADIUS, uses:0 };
}

export function empStatus(simulation) {
  if (!simulation?.emp) return { ready:false, label:'Robot only' };
  const { run, emp } = simulation;
  if (run.status !== 'running') return { ready:false, label:run.status === 'ready' ? 'Move first' : 'Finished' };
  if (emp.cooldown > 0) return { ready:false, label:`${emp.cooldown.toFixed(1)}s` };
  if (run.staggerRemaining > 0) return { ready:false, label:'Staggered' };
  return { ready:true, label:'Ready' };
}

/** One pulse targets machinery near its origin; it never shields the player. */
export function activateEmp(simulation) {
  if (!empStatus(simulation).ready) return false;
  const { emp, player, challenge } = simulation;
  emp.cooldown = EMP_COOLDOWN;
  emp.remaining = EMP_DURATION;
  emp.origin = { x:player.x, y:player.y };
  emp.uses++;
  const until = challenge.clock + EMP_DURATION;
  for (const trap of challenge.traps) {
    if (Math.hypot(trap.x - player.x, trap.y - player.y) <= EMP_RADIUS) trap.suppressedUntil = until;
  }
  for (const laser of challenge.terrain.lasers) {
    const closestX = Math.max(laser.x1, Math.min(laser.x2, player.x));
    if (Math.hypot(closestX - player.x, laser.y - player.y) <= EMP_RADIUS) {
      laser.suppressedUntil = until;
      laser.state = 'idle';
    }
  }
  return true;
}

/** Pauses with simulation time, independently of rendering or wall-clock time. */
export function advanceEmp(simulation, dt) {
  const emp = simulation?.emp;
  if (!emp || simulation.run.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
  emp.cooldown = Math.max(0, emp.cooldown - dt);
  emp.remaining = Math.max(0, emp.remaining - dt);
  if (emp.cooldown < 1e-9) emp.cooldown = 0;
  if (emp.remaining < 1e-9) emp.remaining = 0;
}
