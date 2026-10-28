import { texture } from './pixel-utils.js';

export const COLLECTIBLE_FRAME_COUNT = 48;
export const COLLECTIBLE_ANCHOR = { x:22, y:40 };
const TAU = Math.PI * 2;
const SEGMENTS = 40;
const RADIUS = 14;
const HALF_THICKNESS = .16;

// Approved outlined mark, drawn on its native grid rather than downsampling the app logo.
const LIGHTNING = [
  '....................',
  '....................',
  '..........##........',
  '.........###........',
  '........####........',
  '.......##.##........',
  '......##..##........',
  '.....##...########..',
  '....##....########..',
  '...##.........##....',
  '..########...##.....',
  '..########..##......',
  '........##.##.......',
  '........####........',
  '........###.........',
  '........##..........',
  '.......##...........',
  '.......#............',
  '....................',
  '....................',
];

function paintFace(ctx) {
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
    const dx = x + .5 - RADIUS, dy = y + .5 - RADIUS, radiusSquared = dx * dx + dy * dy;
    if (radiusSquared > 196) continue;
    let color = '#443820';
    if (radiusSquared <= 169) {
      const light = (-dx * .6 - dy * .8) / 13;
      color = light > .65 ? '#f1d28b' : light > 0 ? '#dfb365' : '#bd8b45';
      if (radiusSquared > 144 && dx < -2 && dy < -8) color = '#fff0bb';
    }
    if (radiusSquared <= 121) color = dy < 0 ? '#bd9a50' : '#816236';
    if (radiusSquared <= 100) {
      color = radiusSquared > 81 ? '#109c70' : dy < -2 ? '#22daa0' : dy > 4 ? '#13b57e' : '#19ce91';
      const column = Math.floor(dx + 10), row = Math.floor(dy + 10);
      if (LIGHTNING[row]?.[column] === '#') color = '#102d23';
      else if (dy < -6 && dy > -8 && dx > -6 && dx < -2) color = '#8bf0bc';
    }
    ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1);
  }
}

// A thin cylinder, projected into the same pixel-art space as the forest.
function rotate([x, y, z], angle) {
  const cosine = Math.cos(angle), sine = Math.sin(angle), pitch = .18;
  const rx = x * cosine + z * sine, rz = -x * sine + z * cosine;
  return [rx, y * Math.cos(pitch) - rz * Math.sin(pitch), y * Math.sin(pitch) + rz * Math.cos(pitch)];
}
function project(vertex, angle) {
  const [x, y, depth] = rotate(vertex, angle);
  return { x:22 + x * RADIUS, y:20 - y * RADIUS, depth };
}
function ring(angle, side, radius = 1) {
  return Array.from({ length:SEGMENTS }, (_, index) => {
    const phase = index / SEGMENTS * TAU;
    return project([Math.cos(phase) * radius, Math.sin(phase) * radius, side * HALF_THICKNESS], angle);
  });
}
function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.closePath();
}

export function projectCoin(angle) {
  const surfaces = [];
  for (let index = 0; index < SEGMENTS; index++) {
    const a = index / SEGMENTS * TAU, b = (index + 1) / SEGMENTS * TAU;
    const normal = rotate([Math.cos((a + b) / 2), Math.sin((a + b) / 2), 0], angle);
    if (normal[2] <= .001) continue;
    const points = [[Math.cos(a),Math.sin(a),-HALF_THICKNESS], [Math.cos(b),Math.sin(b),-HALF_THICKNESS],
      [Math.cos(b),Math.sin(b),HALF_THICKNESS], [Math.cos(a),Math.sin(a),HALF_THICKNESS]].map(vertex => project(vertex, angle));
    surfaces.push({ kind:'edge', index, normal, points, depth:points.reduce((sum, point) => sum + point.depth, 0) / 4 });
  }
  for (const side of [-1, 1]) {
    const normal = rotate([0, 0, side], angle);
    if (normal[2] <= .001) continue;
    const points = ring(angle, side);
    surfaces.push({ kind:'face', side, normal, points, depth:project([0,0,side * HALF_THICKNESS], angle).depth });
  }
  return surfaces.sort((a, b) => a.depth - b.depth);
}

export function paintCoin(ctx, face, angle) {
  for (const surface of projectCoin(angle)) {
    if (surface.kind === 'edge') {
      const light = Math.max(0, surface.normal[0] * -.45 + surface.normal[1] * .6 + surface.normal[2] * .65);
      const brightness = .7 + light * .4;
      polygon(ctx, surface.points);
      ctx.fillStyle = `rgb(${Math.round(164 * brightness)},${Math.round(113 * brightness)},${Math.round(56 * brightness)})`;
      ctx.fill();
      continue;
    }
    const { side } = surface;
    // Both sides keep the emblem upright throughout the existing 3D rotation.
    const origin = project([-side, 1, side * HALF_THICKNESS], angle);
    const right = project([side, 1, side * HALF_THICKNESS], angle);
    const bottom = project([-side, -1, side * HALF_THICKNESS], angle);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform((right.x - origin.x) / face.width, (right.y - origin.y) / face.width,
      (bottom.x - origin.x) / face.height, (bottom.y - origin.y) / face.height, origin.x, origin.y);
    ctx.drawImage(face, 0, 0);
    ctx.restore();
  }
}

let artPromise;
export function createCollectibleArt() {
  return artPromise ??= Promise.resolve().then(() => {
    const face = texture(28, 28, paintFace);
    const frames = Array.from({ length:COLLECTIBLE_FRAME_COUNT }, (_, frame) =>
      texture(44, 44, ctx => paintCoin(ctx, face, frame / COLLECTIBLE_FRAME_COUNT * TAU)));
    const shadow = texture(36, 12, ctx => {
      ctx.fillStyle = '#142f2860';
      ctx.beginPath(); ctx.ellipse(18, 7, 11, 3, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#e9ce8055';
      ctx.beginPath(); ctx.ellipse(18, 6, 15, 4, 0, 0, TAU); ctx.stroke();
    });
    return { frames, shadow };
  });
}
