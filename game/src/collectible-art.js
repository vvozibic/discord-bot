import { texture } from './pixel-utils.js';

export const COLLECTIBLE_FRAME_COUNT = 48;
export const COLLECTIBLE_ANCHOR = { x:22, y:40 };
const TAU = Math.PI * 2;
const SEGMENTS = 40;
const RADIUS = 14;
const HALF_THICKNESS = .16;

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

export function paintCoin(ctx, logo, angle) {
  for (const surface of projectCoin(angle)) {
    if (surface.kind === 'edge') {
      const light = Math.max(0, surface.normal[0] * -.45 + surface.normal[1] * .6 + surface.normal[2] * .65);
      const brightness = (.55 + light * .5) * (surface.index % 2 ? 1 : .82);
      polygon(ctx, surface.points);
      ctx.fillStyle = `rgb(${Math.round(218 * brightness)},${Math.round(165 * brightness)},${Math.round(63 * brightness)})`;
      ctx.fill();
      continue;
    }
    const { side, normal } = surface;
    const gold = ctx.createLinearGradient(0, 5, 0, 35);
    gold.addColorStop(0, '#fff0ae'); gold.addColorStop(.35, '#eac05d'); gold.addColorStop(1, '#a76d24');
    polygon(ctx, surface.points); ctx.fillStyle = gold; ctx.fill();
    ctx.strokeStyle = '#f8e8a4'; ctx.lineWidth = .8; ctx.stroke();
    polygon(ctx, ring(angle, side, .88)); ctx.fillStyle = '#866023'; ctx.fill();

    // Crop only the empty green margin; the original lightning artwork stays intact.
    const radius = .77;
    const origin = project([-side * radius, radius, side * HALF_THICKNESS], angle);
    const right = project([side * radius, radius, side * HALF_THICKNESS], angle);
    const bottom = project([-side * radius, -radius, side * HALF_THICKNESS], angle);
    ctx.save();
    polygon(ctx, ring(angle, side, radius)); ctx.clip();
    ctx.setTransform((right.x - origin.x) / logo.width, (right.y - origin.y) / logo.width,
      (bottom.x - origin.x) / logo.height, (bottom.y - origin.y) / logo.height, origin.x, origin.y);
    ctx.drawImage(logo, logo.width * .2, logo.height * .2, logo.width * .6, logo.height * .6, 0, 0, logo.width, logo.height);
    ctx.restore();
    polygon(ctx, ring(angle, side, radius)); ctx.fillStyle = `rgba(8,41,25,${.12 * (1 - normal[2])})`; ctx.fill();
    ctx.strokeStyle = '#ffe39a'; ctx.lineWidth = .65; ctx.stroke();
  }
}

let artPromise;
export function createCollectibleArt() {
  return artPromise ??= (async () => {
    const logo = new Image();
    logo.src = new URL('assets/pulse-logo.png', document.baseURI).href;
    await logo.decode();
    const frames = Array.from({ length:COLLECTIBLE_FRAME_COUNT }, (_, frame) =>
      texture(44, 44, ctx => paintCoin(ctx, logo, frame / COLLECTIBLE_FRAME_COUNT * TAU + .18)));
    const shadow = texture(36, 12, ctx => {
      ctx.fillStyle = '#142f2860';
      ctx.beginPath(); ctx.ellipse(18, 7, 11, 3, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#e9ce8055';
      ctx.beginPath(); ctx.ellipse(18, 6, 15, 4, 0, 0, TAU); ctx.stroke();
    });
    return { frames, shadow, logo };
  })();
}
