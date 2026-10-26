import test from 'node:test';
import assert from 'node:assert/strict';
import { stickVector, createTouchJoystick } from '../src/touch-joystick.js';
import { movePlayer, configureWorld, PLAYER_SPEED } from '../src/world.js';

function fixture() {
  const listeners = new Map(), capture = new Set(), style = new Map();
  let allowed = true, engages = 0;
  const element = {
    dataset:{}, style:{ setProperty:(key, value) => style.set(key, value) },
    querySelector:() => ({ offsetWidth:56 }),
    getBoundingClientRect:() => ({ left:0, top:0, width:140, height:140 }),
    addEventListener:(name, handler) => listeners.set(name, handler),
    setPointerCapture:id => capture.add(id), hasPointerCapture:id => capture.has(id),
    releasePointerCapture:id => capture.delete(id),
  };
  const stick = createTouchJoystick(element, { enabled:() => allowed, onEngage:() => { engages++; } });
  const send = (name, options = {}) => listeners.get(name)({ pointerId:1, button:0, clientX:70, clientY:70, preventDefault() {}, ...options });
  return { element, stick, send, capture, style, get engages() { return engages; }, disable() { allowed = false; } };
}

test('stick has a neutral dead zone, proportional speed, and bounded diagonal movement', () => {
  assert.equal(stickVector(3, 0, 36).power, 0);
  const gentle = stickVector(18, 0, 36), full = stickVector(36, 0, 36), diagonal = stickVector(100, -100, 36);
  assert.ok(gentle.power > 0 && gentle.power < .5);
  assert.equal(full.x, 1);
  assert.equal(full.power, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(diagonal.knobX, diagonal.knobY) - 36) < 1e-12);
  assert.ok(diagonal.x > 0 && diagonal.y < 0);
  for (const args of [[NaN,0,36],[Infinity,0,36],[1,1,0],[1,1,36,1]]) assert.equal(stickVector(...args).power, 0);
});

test('joystick speed changes the travelled distance without changing full-speed movement', () => {
  configureWorld();
  for (const tilt of [.4, 1]) {
    const vector = stickVector(36 * tilt, 0, 36);
    const player = { x:352, y:336 };
    assert.equal(movePlayer(player, vector.x, vector.y, 1 / 60 * vector.power), true);
    assert.ok(Math.abs(player.x - 352 - PLAYER_SPEED / 60 * vector.power) < 1e-8);
  }
});

test('one captured finger controls the stick while other pointers cannot steal or release it', () => {
  const f = fixture();
  f.send('pointerdown');
  f.send('pointermove', { clientX:106 });
  assert.equal(f.stick.vector.x, 1);
  assert.equal(f.element.dataset.active, 'true');
  f.send('pointerdown', { pointerId:2, clientX:34 });
  f.send('pointermove', { pointerId:2, clientX:34 });
  f.send('pointerup', { pointerId:2 });
  assert.equal(f.stick.vector.x, 1);
  assert.equal(f.engages, 1);
  assert.deepEqual([...f.capture], [1]);
  f.send('pointerup');
  assert.equal(f.stick.vector.power, 0);
  assert.equal(f.element.dataset.active, 'false');
  assert.equal(f.capture.size, 0);
  assert.equal(f.style.get('--stick-x'), '0.00px');
});

test('cancellation, capture loss, pause, and explicit reset stop movement immediately', () => {
  for (const ending of ['pointercancel','lostpointercapture','pause','reset']) {
    const f = fixture();
    f.send('pointerdown', { clientY:34 });
    assert.equal(f.stick.vector.y, -1);
    if (ending === 'pause') { f.disable(); f.send('pointermove', { clientY:34 }); }
    else if (ending === 'reset') f.stick.reset();
    else f.send(ending);
    assert.equal(f.stick.vector.power, 0, ending);
    assert.equal(f.capture.size, 0, ending);
    assert.equal(f.element.dataset.active, 'false', ending);
  }
});

test('the stick ignores disabled input and secondary mouse buttons', () => {
  const f = fixture();
  f.send('pointerdown', { button:2, clientX:106 });
  assert.equal(f.engages, 0);
  f.disable(); f.send('pointerdown', { clientX:106 });
  assert.equal(f.stick.vector.power, 0);
  assert.equal(f.engages, 0);
});
