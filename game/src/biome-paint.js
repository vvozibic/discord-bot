import { rect, texture } from './pixel-utils.js';

/** Raster primitives keep authored environment silhouettes on the native pixel grid. */
export function pixelLine(ctx, x1, y1, x2, y2, color, width = 1) {
  x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
  const dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    rect(ctx, x1, y1, width, width, color);
    if (x1 === x2 && y1 === y2) break;
    const twice = error * 2;
    if (twice >= dy) { error += dy; x1 += sx; }
    if (twice <= dx) { error += dx; y1 += sy; }
  }
}

export function pixelOval(ctx, x, y, width, height, color) {
  const rx = width / 2, ry = height / 2;
  if (rx <= 0 || ry <= 0) return;
  for (let row = 0; row < height; row++) {
    const offset = (row + .5 - ry) / ry;
    const span = Math.sqrt(Math.max(0, 1 - offset * offset)) * rx;
    rect(ctx, x + Math.ceil(rx - span), y + row, Math.max(1, Math.floor(span * 2)), 1, color);
  }
}

export function pixelPolygon(ctx, points, color) {
  if (points.length < 3) return;
  const top = Math.floor(Math.min(...points.map(point => point[1])));
  const bottom = Math.ceil(Math.max(...points.map(point => point[1])));
  for (let y = top; y < bottom; y++) {
    const intersections = [], scan = y + .5;
    for (let index = 0; index < points.length; index++) {
      const [ax, ay] = points[index], [bx, by] = points[(index + 1) % points.length];
      if ((ay <= scan && by > scan) || (by <= scan && ay > scan)) {
        intersections.push(ax + (scan - ay) * (bx - ax) / (by - ay));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = Math.ceil(intersections[index]), right = Math.ceil(intersections[index + 1]);
      if (right > left) rect(ctx, left, y, right - left, 1, color);
    }
  }
}

/** Only placement is shared. Each environment supplies its own six authored painters. */
export function buildBiomeScene(world, painters) {
  const { WORLD, HUT, TREES, LOGS } = world;
  const ground = texture(WORLD.width, WORLD.height, painters.ground);
  const props = Array.from({ length:4 }, (_, variant) => texture(52, 72, ctx => painters.prop(ctx, variant)));
  const landmark = texture(HUT.width + 24, HUT.height + 48, painters.landmark);
  const scenery = [
    ...TREES.map(({ x, y }, index) => ({ x:x - 26, y:y - 52, depth:y + 12, asset:props[index % props.length] })),
    { x:HUT.x - 12, y:HUT.y - 24, depth:HUT.y + HUT.height, asset:landmark },
    ...LOGS.map((log, index) => ({ x:log.x - 3, y:log.y - 3, depth:log.y + log.height,
      asset:texture(log.width + 8, log.height + 10, ctx => painters.barrier(ctx, log, index)) })),
  ].sort((a, b) => a.depth - b.depth);
  return { ground, scenery, guardianTexture:texture(40, 52, painters.guardian), guardianAnchor:{ x:20, y:42 },
    portalTextures:[false, true].map(active => texture(64, 80, ctx => painters.gate(ctx, active))) };
}
