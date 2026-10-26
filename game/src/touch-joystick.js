const NEUTRAL = Object.freeze({ x:0, y:0, power:0, knobX:0, knobY:0 });

export function stickVector(dx, dy, radius, deadZone = .16) {
  if (![dx, dy, radius, deadZone].every(Number.isFinite) || radius <= 0 || deadZone < 0 || deadZone >= 1) return NEUTRAL;
  const distance = Math.hypot(dx, dy);
  if (!distance) return NEUTRAL;
  const tilt = Math.min(1, distance / radius);
  const power = Math.max(0, (tilt - deadZone) / (1 - deadZone));
  return { x:dx / distance * power, y:dy / distance * power, power,
    knobX:dx / distance * tilt * radius, knobY:dy / distance * tilt * radius };
}

/** One captured finger controls movement; a second finger stays free for Shield. */
export function createTouchJoystick(element, { enabled, onEngage }) {
  const thumb = element.querySelector('.joystick-thumb');
  let pointerId = null, center = null, radius = 1, vector = NEUTRAL;
  function paint() {
    element.style.setProperty('--stick-x', `${vector.knobX.toFixed(2)}px`);
    element.style.setProperty('--stick-y', `${vector.knobY.toFixed(2)}px`);
    element.dataset.active = String(pointerId !== null);
  }
  function reset() {
    const previous = pointerId;
    pointerId = null; center = null; vector = NEUTRAL; paint();
    if (previous !== null && element.hasPointerCapture(previous)) element.releasePointerCapture(previous);
  }
  function update(event) {
    vector = stickVector(event.clientX - center.x, event.clientY - center.y, radius);
    paint();
  }
  element.addEventListener('pointerdown', event => {
    if (pointerId !== null || event.button !== 0 || !enabled()) return;
    event.preventDefault(); onEngage();
    const bounds = element.getBoundingClientRect();
    center = { x:bounds.left + bounds.width / 2, y:bounds.top + bounds.height / 2 };
    radius = Math.max(1, (bounds.width - thumb.offsetWidth) / 2 - 6);
    pointerId = event.pointerId;
    element.setPointerCapture(pointerId); update(event);
  });
  element.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;
    if (!enabled()) { reset(); return; }
    event.preventDefault(); update(event);
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) element.addEventListener(name, event => {
    if (event.pointerId === pointerId) reset();
  });
  element.addEventListener('contextmenu', event => event.preventDefault());
  paint();
  return { reset, get vector() { return vector; } };
}
