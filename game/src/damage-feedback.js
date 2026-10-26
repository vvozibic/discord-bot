const COLORS = Object.freeze({ lava:'#ffb46c', laser:'#ffb5c8', crumble:'#e9cb92', hunter:'#ffad9d' });

/** Cosmetic impact state. It never changes the authoritative simulation clock. */
export function createDamageFeedback() {
  let impact = null;
  let labels = [];
  function hit({ x, y, direction = { x:0, y:1 }, damage = null, hazard = 'impact', lethal = false }) {
    const length = Math.hypot(direction.x, direction.y) || 1;
    const normal = { x:direction.x / length, y:direction.y / length };
    const item = { x, y, direction:normal, damage, hazard, lethal, age:0, color:COLORS[hazard] ?? '#ffc392' };
    impact = item;
    labels = [...labels, item].slice(-4);
  }
  function advance(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const item of labels) item.age += dt;
    labels = labels.filter(item => item.age < .9);
    if (impact?.age >= .45) impact = null;
  }
  function sample(reducedMotion = false) {
    const strength = impact ? Math.max(0, 1 - impact.age / .4) : 0;
    const shake = reducedMotion || !impact ? { x:0, y:0 } : {
      x:Math.sin(impact.age * 72) * strength * 2.3,
      y:Math.cos(impact.age * 61) * strength * 1.5,
    };
    const sparks = [];
    if (impact && !reducedMotion) for (let index = 0; index < 9; index++) {
      const angle = Math.atan2(impact.direction.y, impact.direction.x) + (index - 4) * .35;
      const speed = 28 + index % 3 * 13;
      sparks.push({ x:impact.x + Math.cos(angle) * speed * impact.age,
        y:impact.y - 12 + Math.sin(angle) * speed * impact.age + 48 * impact.age ** 2,
        alpha:strength, color:impact.color, size:index % 2 + 1 });
    }
    return {
      strength, shake, sparks,
      recoil:impact && !reducedMotion ? Math.sin(Math.min(1, impact.age / .25) * Math.PI) * 2.5 : 0,
      labels:labels.map(item => ({ x:item.x, y:item.y - 44 - (reducedMotion ? 0 : item.age * 22),
        text:item.damage === null ? 'HIT' : `−${item.damage} HP`, color:item.color,
        alpha:Math.min(1, Math.max(0, (.9 - item.age) / .25)) })),
    };
  }
  return { hit, advance, sample, clear() { impact = null; labels = []; } };
}
