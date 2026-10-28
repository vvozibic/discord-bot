// Match the layout that actually displays the joystick, including wide touch tablets.
const TOUCH_QUERY = '(pointer: coarse), (max-width: 600px), (max-width: 960px) and (max-height: 500px), (orientation: landscape) and (max-width: 1280px) and (max-height: 600px)';
const media = globalThis.matchMedia?.(TOUCH_QUERY);
const touch = Object.freeze({
  touch:true,
  movement:'Drag the joystick to move, or tap the ground to walk.',
  moveShort:'Drag the joystick to move.',
  dashAction:'Move and tap Dash.',
  shieldAction:'Tap Shield',
  magicAction:'Tap Magic',
  empAction:'Tap EMP',
  talkAction:'Tap Talk to elder.',
  elderMarker:'ELDER · TAP TALK',
  groundAction:'Tap clear ground.',
  restartTitle:'Restart this level',
  footer:'Drag the joystick to move. Tap the ability buttons to use them.',
});
const desktop = Object.freeze({
  touch:false,
  movement:'Move with WASD or arrow keys, or click the ground to walk.',
  moveShort:'WASD or arrow keys to move.',
  dashAction:'Move and press Shift to dash.',
  shieldAction:'Press Space',
  magicAction:'Press F',
  empAction:'Press F',
  talkAction:'Press E or click Talk to elder.',
  elderMarker:'TALK TO ELDER [E]',
  groundAction:'Click clear ground.',
  restartTitle:'Restart this level (R)',
  footer:'Move with WASD or arrow keys. Space: shield. Shift: dash. F: character ability. Click the ground to walk.',
});

export function getControlsHelp() { return media?.matches ? touch : desktop; }
export function onControlsChange(listener) {
  media?.addEventListener('change',listener);
  return () => media?.removeEventListener('change',listener);
}
