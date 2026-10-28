import { rect, texture } from './pixel-utils.js';
import { paintRobot } from './robot-art.js';
import { paintWizard, WIZARD_CAST_POSES } from './wizard-art.js';
import { moonlightFrame } from './cosmetic-art.js';

export const HERO_CHARACTERS = Object.freeze([
  Object.freeze({ id:'wizard', name:'Blue wizard', detail:'Staff magic damages and interrupts the hunter.',
    ability:'Magic recharges in 2 seconds. Get within range with a clear line to the hunter.' }),
  Object.freeze({ id:'robot', name:'Trail robot', detail:'Heat builds 20% more slowly on hot ground.',
    ability:'EMP freezes pulse traps and lasers inside a nearby ring around you for 1.5 seconds. Recharges in 10 seconds.' }),
]);

const COLORS = {
  outline: '#243b3a',
  skin: '#e3b98c',
  skinLight: '#f3d2a3',
  gold: '#ebc579',
  goldLight: '#ffe3a1',
  leatherLight: '#c09b67',
  leatherShade: '#6a513c',
  boot: '#665341',
  bootLight: '#9c7d54',
};
const WALK = [
  { left: -1, right: 1, liftLeft: 0, liftRight: 0, arm: 1, bob: 0 },
  { left: -1, right: 1, liftLeft: 1, liftRight: 0, arm: 2, bob: -1 },
  { left: 0, right: 0, liftLeft: 0, liftRight: 0, arm: 1, bob: 0 },
  { left: 1, right: -1, liftLeft: 0, liftRight: 0, arm: -1, bob: 0 },
  { left: 1, right: -1, liftLeft: 0, liftRight: 1, arm: -2, bob: -1 },
  { left: 0, right: 0, liftLeft: 0, liftRight: 0, arm: -1, bob: 0 },
];
const IDLE = { left: 0, right: 0, liftLeft: 0, liftRight: 0, arm: 0, bob: 0 };

function pixel(ctx, x, y, width, height, color) {
  rect(ctx, x, y, width, height, COLORS[color] ?? color);
}

function paintGuardian(ctx) {
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#304d40';
  ctx.fillText('GUARDIAN', 37, 11);
  ctx.fillStyle = '#f5e6b8';
  ctx.fillText('GUARDIAN', 36, 10);
  ctx.save();
  ctx.translate(20, 14);
  pixel(ctx, 7, 35, 19, 3, '#3b5946');
  // The camp keeper is taller, with a russet mantle and a pale beard.
  pixel(ctx, 10, 30, 6, 6, 'outline');
  pixel(ctx, 19, 30, 6, 6, 'outline');
  pixel(ctx, 11, 32, 4, 3, 'boot');
  pixel(ctx, 20, 32, 4, 3, 'boot');
  pixel(ctx, 10, 34, 5, 1, 'bootLight');
  pixel(ctx, 20, 34, 5, 1, 'bootLight');
  pixel(ctx, 8, 20, 19, 13, 'outline');
  pixel(ctx, 9, 21, 17, 10, '#9d7750');
  pixel(ctx, 10, 22, 4, 9, '#c39b65');
  pixel(ctx, 22, 23, 4, 9, '#7c6047');
  pixel(ctx, 9, 31, 17, 2, '#71583f');
  pixel(ctx, 11, 31, 3, 1, '#d5b37b');
  pixel(ctx, 8, 20, 19, 3, '#754d3d');
  pixel(ctx, 9, 20, 16, 2, '#b98558');
  pixel(ctx, 10, 20, 6, 1, '#d2a36a');
  pixel(ctx, 17, 22, 3, 5, '#7c4d3d');
  pixel(ctx, 18, 23, 1, 2, 'gold');
  pixel(ctx, 9, 28, 17, 2, 'leatherShade');
  pixel(ctx, 17, 28, 3, 2, 'gold');
  pixel(ctx, 7, 23, 4, 8, '#6b5542');
  pixel(ctx, 7, 24, 2, 4, '#b28b5c');
  pixel(ctx, 8, 30, 3, 2, 'skin');
  pixel(ctx, 25, 23, 4, 6, '#6b5542');
  pixel(ctx, 26, 24, 2, 3, '#b28b5c');
  pixel(ctx, 26, 28, 3, 3, 'skin');
  // A modest wooden staff carries a carved brass trail marker.
  pixel(ctx, 29, 15, 2, 22, 'leatherShade');
  pixel(ctx, 29, 15, 1, 21, 'leatherLight');
  pixel(ctx, 28, 14, 4, 4, 'outline');
  pixel(ctx, 29, 14, 2, 3, 'gold');
  pixel(ctx, 29, 14, 1, 1, 'goldLight');
  pixel(ctx, 27, 28, 3, 2, 'skinLight');
  pixel(ctx, 12, 5, 11, 2, 'outline');
  pixel(ctx, 10, 7, 15, 3, 'outline');
  pixel(ctx, 9, 10, 17, 9, 'outline');
  pixel(ctx, 11, 18, 13, 2, 'outline');
  pixel(ctx, 12, 7, 11, 2, '#b88b5a');
  pixel(ctx, 11, 9, 13, 8, '#96714e');
  pixel(ctx, 10, 11, 2, 5, '#c49d67');
  pixel(ctx, 13, 8, 6, 1, '#d8b77b');
  pixel(ctx, 23, 10, 2, 7, '#735944');
  pixel(ctx, 13, 10, 10, 7, '#d5ab7d');
  pixel(ctx, 14, 11, 7, 1, 'skinLight');
  pixel(ctx, 13, 10, 10, 2, '#c8c9b0');
  pixel(ctx, 13, 12, 1, 3, '#e3dbc0');
  pixel(ctx, 21, 12, 2, 4, '#a8ad9b');
  pixel(ctx, 14, 13, 2, 1, 'outline');
  pixel(ctx, 19, 13, 2, 1, 'outline');
  pixel(ctx, 14, 16, 8, 3, '#dfd7b9');
  pixel(ctx, 15, 18, 6, 3, '#dfd7b9');
  pixel(ctx, 17, 20, 2, 1, '#bfc1a9');
  pixel(ctx, 15, 16, 5, 1, '#f2e5c7');
  pixel(ctx, 17, 16, 2, 1, '#927957');
  ctx.restore();
}

const cachedArt = new Map();
let keeperArt;

// Atlas creation is lazy and memoized; no drawing or allocation occurs in the game loop.
export function createHeroArt(character = 'robot', palette = 'classic') {
  const id = HERO_CHARACTERS.some(hero => hero.id === character) ? character : 'robot';
  if (palette === 'moonlight') {
    const key = `${id}:moonlight`;
    if (!cachedArt.has(key)) {
      const original = createHeroArt(id);
      const recolor = frames => Object.fromEntries(Object.entries(frames).map(([direction, value]) =>
        [direction, Array.isArray(value) ? value.map(moonlightFrame) : moonlightFrame(value)]));
      cachedArt.set(key, { ...original, idleFrames:recolor(original.idleFrames), walkFrames:recolor(original.walkFrames),
        ...(original.castFrames ? { castFrames:recolor(original.castFrames) } : {}) });
    }
    return cachedArt.get(key);
  }
  if (cachedArt.has(id)) return cachedArt.get(id);
  const paint = id === 'wizard' ? paintWizard : paintRobot;
  const directions = ['up', 'down', 'left', 'right'];
  const walkFrames = Object.fromEntries(directions.map(direction => [
    direction, WALK.map(pose => texture(32, 40, ctx => paint(ctx, direction, pose))),
  ]));
  const idleFrames = Object.fromEntries(directions.map(direction => [
    direction, texture(32, 40, ctx => paint(ctx, direction, IDLE)),
  ]));
  keeperArt ??= { guardianTexture:texture(72, 58, paintGuardian), guardianAnchor:{ x:36, y:50 } };
  const art = {
    walkFrames,
    idleFrames,
    ...(id === 'wizard' ? {
      castFrames:Object.fromEntries(directions.map(direction => [direction,WIZARD_CAST_POSES.map(cast => texture(48,48,ctx => {
        ctx.translate(8,4); paintWizard(ctx,direction,{ ...IDLE,cast });
      }))])), castAnchor:{ x:24,y:40 },
    } : {}),
    heroAnchor: { x: 16, y: 36 },
    ...keeperArt,
  };
  cachedArt.set(id,art);
  return art;
}
