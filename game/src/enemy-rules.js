export const ENEMIES = Object.freeze({
  wisp:Object.freeze({ name:'Wisp', radius:16, speed:1, colors:['#a66b45','#e6ae61','#ffe6aa'] }),
  scout:Object.freeze({ name:'Scout', radius:14, speed:1.3, colors:['#367d87','#75d0d1','#cef9e9'] }),
  sentinel:Object.freeze({ name:'Sentinel', radius:19, speed:.8, colors:['#9c4750','#df7880','#ffd7af'] }),
});

export function createPatrols(expedition, config) {
  return expedition.hazards.map((hazard, index) => {
    const type = config.enemies[index], definition = ENEMIES[type];
    return { ...hazard, type, radius:definition.radius, period:hazard.period / config.patrolSpeed / definition.speed,
      kind:'wisp', x:hazard.from.x, y:hazard.from.y };
  });
}
export function updatePatrols(hazards, clock) {
  for (const hazard of hazards) {
    const amount = (1 - Math.cos(clock / hazard.period * Math.PI * 2 + hazard.phase)) / 2;
    hazard.x = hazard.from.x + (hazard.to.x - hazard.from.x) * amount;
    hazard.y = hazard.from.y + (hazard.to.y - hazard.from.y) * amount;
  }
}
