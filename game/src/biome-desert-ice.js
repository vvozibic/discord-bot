import { rect, hash, texture } from './pixel-utils.js';
import { buildBiomeScene, pixelPolygon, pixelOval, pixelLine } from './biome-paint.js';

const inRect = (x, y, r, margin = 0) => x >= r.x - margin && x < r.x + r.width + margin
  && y >= r.y - margin && y < r.y + r.height + margin;
const basinsFor = world => world.BASINS ?? [{ ...world.POND, bridge:world.BRIDGE }];

/** Sand is wind-ridged; masonry and living cacti define the ruined oasis. */
export function createDesertArt(world) {
  const { WORLD, PATHS, HUT, ROCKS } = world, basins = basinsFor(world);
  const onPath = (x, y) => PATHS.some(([px, py, width, height]) => inRect(x, y, { x:px, y:py, width, height }));
  const sand = texture(64, 64, ctx => {
    rect(ctx, 0, 0, 64, 64, '#b9ac83');
    for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) {
      const n = hash(x + 77, y + 19);
      if (n > .72) rect(ctx, x, y, 4, 4, '#c0b38a');
      if (n < .22) rect(ctx, x, y, 4, 4, '#b3a47b');
      if (n > .9) rect(ctx, x + 1, y + 2, 2, 1, '#d0c39b');
    }
  });
  function ground(ctx) {
    for (let y = 0; y < WORLD.height; y += 64) for (let x = 0; x < WORLD.width; x += 64) ctx.drawImage(sand, x, y);
    // Interrupted contour strokes describe low sand drifts without adding obstacles.
    for (let y = 50; y < WORLD.height - 24; y += 35) for (let x = 40; x < WORLD.width - 20; x += 76) {
      const dx = Math.floor(hash(x, y) * 14), px = x + dx;
      if (onPath(px, y) || basins.some(r => inRect(px, y, r, 24))) continue;
      pixelLine(ctx, px, y + 4, px + 13, y, '#a89a73');
      pixelLine(ctx, px + 13, y, px + 32, y, '#a89a73');
      pixelLine(ctx, px + 5, y + 6, px + 28, y + 3, '#d1c39a');
      rect(ctx, px + 35, y + 5, 8, 1, '#cabe94');
    }
    for (let y = 28; y < WORLD.height - 24; y += 4) for (let x = 28; x < WORLD.width - 24; x += 4) {
      if (!onPath(x, y)) continue;
      const seam = y % 16 === 0 || (x + (Math.floor(y / 16) % 2) * 8) % 32 === 0;
      rect(ctx, x, y, 4, 4, seam ? '#a99d7c' : hash(x, y) > .65 ? '#d8cdab' : '#cec3a0');
      if (!onPath(x - 4, y) || !onPath(x, y - 4)) rect(ctx, x, y, 4, 1, '#e7ddbd');
    }
    for (const basin of basins) {
      const { x, y, width:w, height:h } = basin, bridge = basin.bridge ?? world.BRIDGE;
      rect(ctx, x - 7, y - 7, w + 14, h + 14, '#92896e');
      rect(ctx, x - 4, y - 4, w + 8, h + 8, '#dfcf9f');
      rect(ctx, x, y, w, h, '#123f56');
      rect(ctx, x + 3, y + 3, w - 6, h - 6, '#1e5b70');
      rect(ctx, x + 4, y + h - 9, w - 8, 5, '#33788a');
      for (let py = y + 13; py < y + h - 10; py += 18) for (let px = x + 10; px < x + w - 12; px += 28) {
        rect(ctx, px, py, 11, 1, '#3b8290'); rect(ctx, px + 9, py - 2, 6, 1, '#27687d');
      }
      for (let py = y - 4; py <= y + h; py += 16) {
        rect(ctx, x - 5, py, 5, 2, '#a0946d'); rect(ctx, x + w, py + 5, 4, 2, '#a0946d');
      }
      const { x:bx, y:by, width:bw, height:bh } = bridge;
      rect(ctx, bx - 2, by + 3, bw + 4, bh, '#193e4c');
      rect(ctx, bx, by, bw, bh, '#b6a887');
      for (let py = by; py < by + bh; py += 16) {
        rect(ctx, bx + 2, py + 1, bw - 4, Math.min(14, by + bh - py - 1), '#dbcfaa');
        rect(ctx, bx + 3, py + 2, bw - 6, 1, '#f1e3bc');
        rect(ctx, bx + bw / 2, py + 2, 1, 11, '#c1b38c');
      }
      for (const px of [bx, bx + bw - 3]) rect(ctx, px, by, 3, bh, '#9d9278');
    }
    for (const [x, y] of ROCKS) {
      pixelPolygon(ctx, [[x,y+3],[x+7,y-1],[x+17,y+1],[x+20,y+10],[x+1,y+11]], '#92866c');
      rect(ctx, x + 3, y + 2, 13, 6, '#cfbf95'); rect(ctx, x + 4, y + 2, 8, 1, '#ead9ae');
      rect(ctx, x + 10, y + 4, 1, 4, '#998d70'); rect(ctx, x + 11, y + 6, 4, 1, '#998d70');
    }
    pixelOval(ctx, world.SPAWN.x - 13, world.SPAWN.y - 6, 26, 13, '#ccbd94');
    for (const dx of [-18, 16]) rect(ctx, world.SPAWN.x + dx, world.SPAWN.y - 3, 2, 6, '#e5d6ad');
  }
  function prop(ctx, variant) {
    pixelOval(ctx, 13, 59, 28, 10, '#796e594b');
    if (variant < 2) {
      const top = variant === 0 ? 16 : 8;
      rect(ctx, 20, top + 4, 13, 48 - top, '#345d50'); rect(ctx, 23, top, 7, 58 - top, '#416f5c');
      rect(ctx, 24, top + 4, 2, 52 - top, '#6c9270'); rect(ctx, 30, top + 5, 2, 47 - top, '#244e46');
      rect(ctx, 21, 55, 11, 10, '#365747');
      if (variant === 0) {
        rect(ctx, 11, 32, 10, 7, '#3e6a56'); rect(ctx, 10, 25, 6, 12, '#416f5c');
        rect(ctx, 12, 25, 2, 10, '#7a9a73'); rect(ctx, 32, 41, 10, 6, '#315c4d');
        rect(ctx, 37, 31, 6, 13, '#416f5c'); rect(ctx, 38, 32, 2, 9, '#70936c');
      } else {
        rect(ctx, 14, 41, 8, 6, '#3e6a56'); rect(ctx, 13, 34, 5, 12, '#3e6a56');
        rect(ctx, 24, 6, 6, 3, '#e2cdb2'); rect(ctx, 26, 4, 3, 3, '#e8d7bc');
      }
      for (let py = top + 8; py < 54; py += 9) { rect(ctx, 19, py, 2, 1, '#c4c19a'); rect(ctx, 32, py + 3, 2, 1, '#c4c19a'); }
    } else {
      rect(ctx, 18, 58, 17, 8, '#8e8064'); rect(ctx, 19, 59, 15, 2, '#d8c69c');
      rect(ctx, 21, 22, 11, 37, '#c6b389'); rect(ctx, 21, 23, 3, 35, '#e8d4a6');
      rect(ctx, 29, 22, 3, 37, '#9d8c6d');
      if (variant === 2) {
        rect(ctx, 16, 17, 20, 7, '#9e8b69'); rect(ctx, 17, 17, 18, 2, '#e0cda1');
        rect(ctx, 20, 12, 12, 5, '#bba680'); rect(ctx, 20, 12, 5, 1, '#e0cda1');
        pixelLine(ctx, 26, 29, 29, 34, '#8e7c5e'); pixelLine(ctx, 29, 34, 25, 39, '#8e7c5e');
      } else {
        pixelPolygon(ctx, [[21,22],[26,7],[32,22]], '#d6c195');
        rect(ctx, 24, 29, 5, 2, '#8b7c63'); rect(ctx, 25, 27, 2, 7, '#8b7c63');
        rect(ctx, 24, 39, 5, 5, '#698b82'); rect(ctx, 25, 40, 3, 3, '#a8c2aa');
      }
    }
  }
  function landmark(ctx) {
    const x = 12, y = 24, w = HUT.width, h = HUT.height;
    rect(ctx, x - 3, y + h - 3, w + 6, 7, '#94876c'); rect(ctx, x, y, w, h, '#ab9873');
    rect(ctx, x + 4, y + 5, w - 8, h - 9, '#c5b28a');
    for (let py = y + 13; py < y + h; py += 13) {
      rect(ctx, x + 3, py, w - 6, 1, '#a49371');
      for (let px = x + 14 + ((py - y) % 2) * 8; px < x + w - 6; px += 23) rect(ctx, px, py - 11, 1, 10, '#b19f79');
    }
    for (const px of [x + 3, x + w - 17]) {
      rect(ctx, px, y - 10, 14, h + 7, '#a2916e'); rect(ctx, px + 2, y - 10, 4, h + 6, '#e0cca0');
      rect(ctx, px - 2, y - 14, 18, 7, '#c9b58a'); rect(ctx, px - 1, y - 14, 16, 2, '#f0dab0');
    }
    rect(ctx, x + 18, y - 5, w - 36, 18, '#8d8066'); rect(ctx, x + 19, y - 4, w - 38, 14, '#cfbb91');
    const cx = x + w / 2;
    pixelOval(ctx, cx - 7, y - 3, 14, 11, '#8f8163'); pixelOval(ctx, cx - 4, y, 8, 6, '#dfc68c');
    rect(ctx, cx - 11, y + 32, 22, h - 32, '#665d4e'); rect(ctx, cx - 8, y + 35, 16, h - 35, '#344f52');
    rect(ctx, cx - 13, y + 29, 26, 5, '#e1cda3');
    for (const px of [cx - 23, cx + 19]) { rect(ctx, px, y + 28, 4, 11, '#99876b'); rect(ctx, px + 1, y + 29, 2, 6, '#e1d0a6'); }
  }
  function barrier(ctx, log) {
    rect(ctx, 3, 3, log.width, log.height, '#9f8e6b'); rect(ctx, 3, 3, log.width, 2, '#e0cba0');
    for (let px = 9; px < log.width; px += 13) { rect(ctx, px, 5, 1, Math.max(2, log.height - 2), '#7e735e'); rect(ctx, px + 2, 6, 5, 1, '#bca77e'); }
    rect(ctx, 5, 3 + log.height, log.width - 2, 2, '#756a55');
  }
  function guardian(ctx) {
    pixelOval(ctx, 10, 39, 22, 8, '#796f594f'); rect(ctx, 14, 39, 5, 5, '#635a49'); rect(ctx, 22, 39, 5, 5, '#635a49');
    pixelPolygon(ctx, [[15,22],[25,22],[29,41],[11,41]], '#617b72'); rect(ctx, 17, 24, 3, 15, '#a4b7a0');
    rect(ctx, 15, 15, 11, 11, '#bca082'); rect(ctx, 14, 12, 13, 6, '#dfd0ab'); rect(ctx, 16, 10, 10, 4, '#f0e1bc');
    rect(ctx, 16, 19, 2, 2, '#354e4d'); rect(ctx, 23, 19, 2, 2, '#354e4d'); rect(ctx, 19, 22, 4, 4, '#ded4b8');
    rect(ctx, 8, 23, 2, 20, '#6e604c'); rect(ctx, 7, 20, 4, 4, '#c4c7a0'); rect(ctx, 10, 28, 5, 4, '#bca082');
  }
  function gate(ctx, active) {
    pixelOval(ctx, 5, 43, 55, 13, '#7c715a66');
    for (const x of [10, 43]) {
      rect(ctx, x, 10, 11, 38, '#9f8e6a'); rect(ctx, x + 1, 11, 4, 35, '#dfcca1');
      rect(ctx, x - 2, 43, 15, 6, '#b9a67e'); rect(ctx, x - 3, 7, 17, 6, '#d9c497');
      for (let y = 18; y < 39; y += 8) rect(ctx, x + 2, y, 6, 1, '#8c8168');
    }
    rect(ctx, 18, 3, 28, 9, '#aa9875'); rect(ctx, 19, 3, 26, 2, '#eddbb0');
    pixelPolygon(ctx, [[23,23],[32,16],[41,23],[41,41],[32,47],[23,41]], active ? '#346d70' : '#726e5d');
    if (active) { pixelPolygon(ctx, [[32,20],[37,29],[32,39],[27,29]], '#a9dbbd'); rect(ctx, 31, 23, 2, 12, '#e5f4d4'); }
    else { rect(ctx, 26, 29, 12, 2, '#a49e7f'); rect(ctx, 31, 24, 2, 12, '#a49e7f'); }
  }
  return buildBiomeScene(world, { ground, prop, landmark, barrier, guardian, gate });
}

/** Frozen blockwork, deep fissures and faceted spires form the ice cavern. */
export function createIceArt(world) {
  const { WORLD, PATHS, HUT, ROCKS } = world, basins = basinsFor(world);
  const onPath = (x, y) => PATHS.some(([px, py, width, height]) => inRect(x, y, { x:px, y:py, width, height }));
  const frost = texture(64, 64, ctx => {
    rect(ctx, 0, 0, 64, 64, '#839fae');
    for (let y = 0; y < 64; y += 8) for (let x = 0; x < 64; x += 8) {
      const n = hash(x + 91, y + 117);
      rect(ctx, x, y, 8, 8, n > .7 ? '#94adba' : n < .25 ? '#7d98a8' : '#879fac');
      if (n > .8) { rect(ctx, x + 1, y + 2, 4, 1, '#b4c8ce'); rect(ctx, x + 2, y + 1, 1, 3, '#b4c8ce'); }
    }
  });
  function ground(ctx) {
    for (let y = 0; y < WORLD.height; y += 64) for (let x = 0; x < WORLD.width; x += 64) ctx.drawImage(frost, x, y);
    for (let y = 40; y < WORLD.height - 12; y += 47) for (let x = 30; x < WORLD.width - 20; x += 83) {
      if (onPath(x, y) || basins.some(r => inRect(x, y, r, 18))) continue;
      pixelLine(ctx, x, y + 5, x + 9, y + 2, '#b9cdd4'); pixelLine(ctx, x + 9, y + 2, x + 23, y + 2, '#b9cdd4');
      pixelLine(ctx, x + 23, y + 2, x + 30, y + 6, '#aac1cb'); rect(ctx, x + 9, y + 7, 13, 1, '#6e8fa2');
    }
    for (let y = 28; y < WORLD.height - 24; y += 4) for (let x = 28; x < WORLD.width - 24; x += 4) {
      if (!onPath(x, y)) continue;
      rect(ctx, x, y, 4, 4, (y % 24 === 0 || x % 24 === 0) ? '#88a8b7' : '#bed0d5');
      if (!onPath(x - 4, y) || !onPath(x, y - 4)) rect(ctx, x, y, 4, 1, '#e2ece9');
    }
    for (const basin of basins) {
      const { x, y, width:w, height:h } = basin, bridge = basin.bridge ?? world.BRIDGE;
      rect(ctx, x - 6, y - 6, w + 12, h + 12, '#dce8e7'); rect(ctx, x - 3, y - 3, w + 6, h + 6, '#5b849f');
      rect(ctx, x, y, w, h, '#16314e'); rect(ctx, x + 5, y + 5, w - 10, h - 10, '#1c3d5c');
      for (let px = x + 4; px < x + w - 7; px += 19) {
        pixelPolygon(ctx, [[px,y],[px+12,y],[px+7,y+11]], '#79a9bd');
        pixelPolygon(ctx, [[px,y+h],[px+10,y+h],[px+3,y+h-8]], '#4e7899');
      }
      for (let py = y + 26; py < y + h - 12; py += 27) { rect(ctx, x + 12, py, Math.max(8, w - 40), 1, '#2c5272'); rect(ctx, x + 20, py + 3, 17, 1, '#426e8c'); }
      const { x:bx, y:by, width:bw, height:bh } = bridge;
      rect(ctx, bx, by, bw, bh, '#6598b1'); rect(ctx, bx + 3, by, bw - 6, bh, '#a8cfdc');
      for (let py = by + 2; py < by + bh - 2; py += 19) {
        pixelPolygon(ctx, [[bx+4,py],[bx+bw-4,py+5],[bx+bw-4,py+13],[bx+4,py+9]], '#c7e3e7');
        pixelLine(ctx, bx + 5, py + 12, bx + bw - 6, py + 16, '#6c9fb6');
      }
      rect(ctx, bx + 1, by, 1, bh, '#e4f2ed'); rect(ctx, bx + bw - 3, by, 2, bh, '#4e839f');
    }
    for (const [x, y] of ROCKS) {
      pixelPolygon(ctx, [[x,y+6],[x+7,y-2],[x+17,y],[x+21,y+10],[x+1,y+12]], '#52758b');
      pixelPolygon(ctx, [[x+2,y+5],[x+8,y],[x+16,y+1],[x+12,y+7]], '#b8d9e0');
      rect(ctx, x + 5, y + 1, 7, 1, '#eef5ee'); rect(ctx, x + 14, y + 5, 3, 4, '#7da7bd');
    }
    for (let x = 0; x < WORLD.width; x += 37) {
      const length = 11 + Math.floor(hash(x, 7) * 14);
      pixelPolygon(ctx, [[x,0],[x+22,0],[x+13,length]], '#557a93');
      pixelPolygon(ctx, [[x+2,0],[x+17,0],[x+12,length-3]], '#a2c4d1');
    }
  }
  function prop(ctx, variant) {
    pixelOval(ctx, 11, 59, 32, 10, '#3f688653');
    const apex = [[26,7],[21,15],[28,3],[24,12]][variant % 4];
    pixelPolygon(ctx, [[19,64],[17,39],apex,[34,39],[33,64]], '#477a9c');
    pixelPolygon(ctx, [[20,61],[20,39],apex,[26,42],[26,63]], '#b8dde4');
    pixelPolygon(ctx, [apex,[31,40],[32,61],[27,63],[26,42]], '#71a7c2');
    pixelLine(ctx, apex[0], apex[1] + 4, 23, 50, '#e3f2ee');
    if (variant !== 1) {
      pixelPolygon(ctx, [[12,62],[11,45],[15,28],[21,46],[23,65]], '#6298b1');
      pixelPolygon(ctx, [[13,61],[13,45],[15,30],[17,47],[17,63]], '#a8d3de');
      pixelPolygon(ctx, [[31,64],[34,40],[40,27],[42,49],[38,65]], '#3f7599');
      pixelPolygon(ctx, [[33,61],[36,42],[40,29],[38,52],[36,64]], '#92c3d4');
    } else {
      rect(ctx, 18, 55, 16, 8, '#c9dee2'); rect(ctx, 19, 54, 8, 2, '#edf4ed');
      pixelLine(ctx, 19, 33, 29, 40, '#4f87a6'); pixelLine(ctx, 29, 40, 26, 47, '#4f87a6');
    }
    rect(ctx, 20, 63, 12, 3, '#507a91'); rect(ctx, 21, 63, 7, 1, '#d6e8e6');
  }
  function landmark(ctx) {
    const x = 12, y = 24, w = HUT.width, h = HUT.height, cx = x + w / 2;
    rect(ctx, x - 2, y + 2, w + 4, h + 2, '#6f95aa'); rect(ctx, x, y, w, h, '#a1becb');
    pixelPolygon(ctx, [[x-4,y+24],[x+8,y+4],[cx,y-15],[x+w-8,y+4],[x+w+4,y+24]], '#c4e0e5');
    pixelPolygon(ctx, [[cx,y-13],[x+w-9,y+5],[x+w+2,y+23],[cx,y+16]], '#82b3c9');
    pixelLine(ctx, cx, y - 12, cx, y + 16, '#edf6ef');
    for (let py = y + 27; py < y + h; py += 13) {
      rect(ctx, x + 2, py, w - 4, 1, '#739db5');
      for (let px = x + 12 + (py % 2) * 7; px < x + w; px += 21) rect(ctx, px, py - 11, 1, 11, '#8fb0c1');
    }
    for (const px of [x + 8, x + w - 25]) {
      rect(ctx, px, y + 35, 17, 15, '#446e8d'); rect(ctx, px + 2, y + 37, 13, 11, '#9bd1df');
      pixelLine(ctx, px + 3, y + 45, px + 11, y + 38, '#e1f2ec');
    }
    pixelOval(ctx, cx - 12, y + 34, 24, 28, '#6f9eb8'); rect(ctx, cx - 12, y + 49, 24, h - 49, '#6f9eb8');
    pixelOval(ctx, cx - 8, y + 39, 16, 23, '#284e70'); rect(ctx, cx - 8, y + 50, 16, h - 50, '#284e70');
    rect(ctx, cx - 4, y + 10, 8, 3, '#f1faf1'); rect(ctx, cx - 1, y + 5, 2, 13, '#f1faf1');
    rect(ctx, x - 2, y + h - 3, w + 4, 4, '#d5e7e6');
  }
  function barrier(ctx, log) {
    rect(ctx, 3, 3, log.width, log.height, '#6c9bb3'); rect(ctx, 4, 3, log.width - 2, 3, '#d2e8e9');
    for (let px = 9; px < log.width; px += 12) { pixelLine(ctx, px, 5, px + 3, 8, '#456e8d'); rect(ctx, px + 3, 7, 1, Math.max(1, log.height - 4), '#456e8d'); }
    rect(ctx, 5, log.height + 3, log.width - 4, 2, '#527d9b');
  }
  function guardian(ctx) {
    pixelOval(ctx, 9, 39, 24, 8, '#426a8756'); rect(ctx, 12, 38, 7, 7, '#324f6e'); rect(ctx, 22, 38, 7, 7, '#324f6e');
    pixelPolygon(ctx, [[13,23],[27,23],[30,40],[10,40]], '#536b94'); rect(ctx, 14, 24, 4, 14, '#a2becd');
    pixelOval(ctx, 11, 9, 20, 21, '#c8dde2'); pixelOval(ctx, 15, 13, 12, 14, '#4b7190');
    rect(ctx, 16, 16, 10, 8, '#c0b9ad'); rect(ctx, 17, 19, 2, 2, '#2f4d6c'); rect(ctx, 23, 19, 2, 2, '#2f4d6c');
    rect(ctx, 16, 25, 10, 4, '#d5e3df'); rect(ctx, 7, 27, 5, 6, '#8eaec6'); rect(ctx, 29, 27, 5, 6, '#8eaec6');
    rect(ctx, 33, 22, 2, 21, '#5b7894'); pixelPolygon(ctx, [[31,22],[34,15],[38,21],[34,26]], '#bce8ed');
  }
  function gate(ctx, active) {
    pixelOval(ctx, 5, 43, 55, 13, '#3f648466');
    pixelPolygon(ctx, [[12,49],[8,32],[15,11],[31,2],[48,12],[56,33],[51,49],[43,47],[46,31],[41,18],[31,12],[22,18],[17,33],[20,48]], '#5c8fab');
    pixelPolygon(ctx, [[12,46],[12,32],[18,14],[31,6],[44,15],[50,32],[49,45],[46,31],[41,18],[31,12],[22,18],[17,33],[18,46]], '#c4e6e8');
    pixelPolygon(ctx, [[23,21],[32,15],[41,22],[44,36],[36,47],[27,47],[20,36]], active ? '#397e9f' : '#486e88');
    if (active) { pixelLine(ctx, 32, 21, 32, 41, '#dbf8f0'); pixelLine(ctx, 24, 31, 40, 31, '#dbf8f0'); pixelLine(ctx, 26, 25, 38, 37, '#a6e5ea'); pixelLine(ctx, 38, 25, 26, 37, '#a6e5ea'); }
    else { pixelPolygon(ctx, [[32,25],[37,32],[32,39],[27,32]], '#9ab8c6'); }
    for (const x of [10, 46]) { rect(ctx, x, 45, 9, 5, '#81b5ca'); rect(ctx, x + 1, 45, 6, 1, '#e8f5ed'); }
  }
  return buildBiomeScene(world, { ground, prop, landmark, barrier, guardian, gate });
}
