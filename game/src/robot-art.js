import { rect } from './pixel-utils.js';

const COLORS = {
  outline: '#203b42',
  joint: '#334e58',
  metalDark: '#65858c',
  metal: '#a8c3c5',
  metalLight: '#e2eee5',
  shine: '#f7f8df',
  tealDark: '#28656d',
  teal: '#398e94',
  tealLight: '#6ac1ba',
  visor: '#16343e',
  visorLight: '#265761',
  cyan: '#67f1ef',
  cyanLight: '#d0ffeb',
  coreDark: '#39835b',
  core: '#70e58b',
  coreLight: '#c2ff96',
};

function pixel(ctx, x, y, width, height, color) {
  rect(ctx, x, y, width, height, COLORS[color] ?? color);
}

function paintLeg(ctx, x, lift, profile = false, far = false) {
  const y = 28 - lift;
  // Separate pistons, knee hinges and broad metal feet keep the walk mechanical.
  pixel(ctx, x + 1, y, 4, 7, 'outline');
  pixel(ctx, x + 2, y, 2, 3, far ? 'metalDark' : 'metal');
  pixel(ctx, x, y + 2, 6, 3, 'outline');
  pixel(ctx, x + 1, y + 2, 4, 2, far ? 'tealDark' : 'teal');
  pixel(ctx, x + 2, y + 2, 2, 1, far ? 'metalDark' : 'metalLight');
  pixel(ctx, x + 2, y + 5, 2, 1, 'metalDark');
  pixel(ctx, x, y + 5, profile ? 7 : 6, 3, 'outline');
  pixel(ctx, x + 1, y + 5, profile ? 5 : 4, 2, far ? 'metalDark' : 'metal');
  pixel(ctx, x + 1, y + 5, profile ? 4 : 3, 1, far ? 'metal' : 'metalLight');
  pixel(ctx, x + (profile ? 5 : 3), y + 6, 1, 1, 'tealDark');
}

function paintArm(ctx, x, swing, far = false) {
  pixel(ctx, x, 20, 5, 4, 'outline');
  pixel(ctx, x + 1, 20, 3, 3, far ? 'tealDark' : 'teal');
  pixel(ctx, x + 1, 20, 2, 1, far ? 'teal' : 'tealLight');
  pixel(ctx, x + 1, 23 + swing, 3, 4, 'outline');
  pixel(ctx, x + 2, 23 + swing, 1, 3, 'metal');
  pixel(ctx, x, 25 + swing, 5, 3, 'joint');
  pixel(ctx, x + 2, 26 + swing, 1, 1, far ? 'metalDark' : 'cyan');
  pixel(ctx, x + 1, 28 + swing, 4, 3, 'outline');
  pixel(ctx, x + 1, 28 + swing, 3, 2, far ? 'metalDark' : 'metal');
  pixel(ctx, x + 2, 29 + swing, 1, 2, 'joint');
}

function paintAntenna(ctx, x = 16) {
  pixel(ctx, x, 4, 1, 4, 'outline');
  pixel(ctx, x - 1, 2, 3, 3, 'outline');
  pixel(ctx, x, 3, 1, 1, 'coreLight');
}

function paintHeadShell(ctx) {
  pixel(ctx, 10, 7, 13, 2, 'outline');
  pixel(ctx, 8, 9, 17, 7, 'outline');
  pixel(ctx, 9, 16, 15, 2, 'outline');
  pixel(ctx, 10, 8, 13, 2, 'metalLight');
  pixel(ctx, 9, 10, 15, 6, 'metal');
  pixel(ctx, 10, 8, 8, 1, 'shine');
  pixel(ctx, 9, 10, 1, 5, 'metalLight');
  pixel(ctx, 23, 10, 1, 6, 'metalDark');
  pixel(ctx, 10, 16, 13, 1, 'metalLight');
  pixel(ctx, 7, 11, 2, 4, 'outline');
  pixel(ctx, 7, 12, 1, 2, 'tealLight');
  pixel(ctx, 24, 11, 2, 4, 'outline');
  pixel(ctx, 25, 12, 1, 2, 'tealDark');
  paintAntenna(ctx);
}

function paintFront(ctx, pose) {
  paintLeg(ctx, 10 + pose.left, pose.liftLeft);
  paintLeg(ctx, 18 + pose.right, pose.liftRight);
  ctx.save();
  ctx.translate(0, pose.bob);
  paintArm(ctx, 6, pose.arm);
  paintArm(ctx, 23, -pose.arm, true);
  pixel(ctx, 14, 17, 5, 3, 'joint');
  pixel(ctx, 15, 18, 3, 1, 'metal');
  pixel(ctx, 10, 19, 14, 10, 'outline');
  pixel(ctx, 11, 20, 12, 8, 'teal');
  pixel(ctx, 11, 20, 4, 1, 'tealLight');
  pixel(ctx, 21, 21, 2, 7, 'tealDark');
  pixel(ctx, 12, 21, 2, 5, 'metalLight');
  pixel(ctx, 14, 21, 6, 6, 'outline');
  pixel(ctx, 15, 22, 4, 4, 'coreDark');
  pixel(ctx, 15, 22, 3, 3, 'core');
  pixel(ctx, 16, 22, 2, 2, 'coreLight');
  pixel(ctx, 21, 22, 1, 1, 'cyan');
  pixel(ctx, 11, 27, 12, 2, 'metalDark');
  pixel(ctx, 14, 28, 6, 2, 'joint');
  pixel(ctx, 15, 28, 4, 1, 'metal');
  paintHeadShell(ctx);
  pixel(ctx, 10, 10, 13, 6, 'outline');
  pixel(ctx, 11, 11, 11, 4, 'visor');
  pixel(ctx, 11, 11, 10, 1, 'visorLight');
  pixel(ctx, 12, 12, 3, 2, 'cyan');
  pixel(ctx, 19, 12, 2, 2, 'cyan');
  pixel(ctx, 12, 12, 2, 1, 'cyanLight');
  pixel(ctx, 19, 12, 1, 1, 'cyanLight');
  pixel(ctx, 15, 16, 4, 1, 'metalDark');
  ctx.restore();
}

function paintBack(ctx, pose) {
  paintLeg(ctx, 10 + pose.left, pose.liftLeft);
  paintLeg(ctx, 18 + pose.right, pose.liftRight);
  ctx.save();
  ctx.translate(0, pose.bob);
  paintArm(ctx, 6, -pose.arm);
  paintArm(ctx, 23, pose.arm, true);
  pixel(ctx, 14, 17, 5, 3, 'joint');
  pixel(ctx, 10, 19, 14, 10, 'outline');
  pixel(ctx, 11, 20, 12, 8, 'teal');
  pixel(ctx, 11, 20, 2, 7, 'tealLight');
  pixel(ctx, 21, 20, 2, 8, 'tealDark');
  // A rigid rear battery with cooling fins, rather than a fabric backpack.
  pixel(ctx, 13, 20, 8, 9, 'outline');
  pixel(ctx, 14, 21, 6, 7, 'metalDark');
  pixel(ctx, 14, 21, 1, 6, 'metalLight');
  pixel(ctx, 16, 21, 3, 1, 'tealLight');
  pixel(ctx, 16, 23, 3, 1, 'joint');
  pixel(ctx, 16, 25, 3, 1, 'joint');
  pixel(ctx, 16, 27, 3, 1, 'core');
  pixel(ctx, 11, 28, 2, 1, 'metal');
  pixel(ctx, 14, 29, 6, 1, 'joint');
  paintHeadShell(ctx);
  pixel(ctx, 12, 11, 9, 4, 'metalDark');
  pixel(ctx, 13, 11, 7, 3, 'tealDark');
  pixel(ctx, 13, 11, 7, 1, 'teal');
  pixel(ctx, 14, 12, 1, 2, 'joint');
  pixel(ctx, 16, 12, 1, 2, 'joint');
  pixel(ctx, 18, 12, 1, 2, 'joint');
  pixel(ctx, 21, 15, 1, 1, 'core');
  ctx.restore();
}

function paintProfile(ctx, pose) {
  paintLeg(ctx, 11 + pose.left, pose.liftLeft, true, true);
  paintLeg(ctx, 17 + pose.right, pose.liftRight, true);
  ctx.save();
  ctx.translate(0, pose.bob);
  paintArm(ctx, 19 + pose.arm, -1, true);
  pixel(ctx, 10, 20, 5, 9, 'outline');
  pixel(ctx, 11, 21, 3, 7, 'metalDark');
  pixel(ctx, 11, 21, 1, 5, 'metalLight');
  pixel(ctx, 12, 23, 2, 1, 'joint');
  pixel(ctx, 12, 25, 2, 1, 'joint');
  pixel(ctx, 12, 27, 2, 1, 'core');
  pixel(ctx, 15, 17, 4, 3, 'joint');
  pixel(ctx, 14, 19, 10, 10, 'outline');
  pixel(ctx, 15, 20, 8, 8, 'teal');
  pixel(ctx, 15, 20, 6, 1, 'tealLight');
  pixel(ctx, 22, 21, 1, 6, 'tealDark');
  pixel(ctx, 23, 22, 2, 4, 'outline');
  pixel(ctx, 23, 22, 1, 3, 'core');
  pixel(ctx, 15, 28, 7, 2, 'joint');
  paintArm(ctx, 15 - pose.arm, 0);
  pixel(ctx, 10, 7, 12, 2, 'outline');
  pixel(ctx, 8, 9, 16, 7, 'outline');
  pixel(ctx, 10, 16, 14, 2, 'outline');
  pixel(ctx, 10, 8, 12, 2, 'metalLight');
  pixel(ctx, 9, 10, 14, 6, 'metal');
  pixel(ctx, 10, 8, 7, 1, 'shine');
  pixel(ctx, 9, 10, 1, 5, 'metalLight');
  pixel(ctx, 10, 16, 13, 1, 'metalDark');
  pixel(ctx, 19, 10, 5, 6, 'outline');
  pixel(ctx, 20, 11, 3, 4, 'visor');
  pixel(ctx, 21, 12, 2, 2, 'cyan');
  pixel(ctx, 22, 12, 1, 1, 'cyanLight');
  pixel(ctx, 12, 11, 5, 5, 'outline');
  pixel(ctx, 13, 12, 3, 3, 'tealDark');
  pixel(ctx, 14, 13, 1, 1, 'cyan');
  paintAntenna(ctx, 15);
  ctx.restore();
}

// All directional frames are rasterized once by the hero atlas, including shadows.
export function paintRobot(ctx, direction, pose) {
  pixel(ctx, 8, 35, 17, 2, '#3b5946');
  pixel(ctx, 10, 37, 13, 1, '#496b4d');
  ctx.save();
  if (direction === 'left') {
    ctx.translate(32, 0);
    ctx.scale(-1, 1);
  }
  if (direction === 'down') paintFront(ctx, pose);
  else if (direction === 'up') paintBack(ctx, pose);
  else paintProfile(ctx, pose);
  ctx.restore();
}
