import { rect, hash } from './pixel-utils.js';
import { buildBiomeScene, pixelPolygon, pixelOval, pixelLine } from './biome-paint.js';

const basinsFor = world => world.BASINS ?? [{ ...world.POND, bridge:world.BRIDGE }];

/** Floating marble terraces, wind-carved pillars and a winged observatory. */
export function createCloudArt(world) {
  const { WORLD, PATHS, HUT, ROCKS } = world;
  return buildBiomeScene(world, {
    ground(ctx) {
      rect(ctx, 0, 0, WORLD.width, WORLD.height, '#507fa9');
      for (let y = 8; y < WORLD.height; y += 40) for (let x = 4; x < WORLD.width; x += 72) {
        const shift = Math.floor(hash(x, y) * 24);
        pixelOval(ctx, x + shift, y, 72, 13, '#80a8c1');
        pixelOval(ctx, x + shift + 11, y - 5, 37, 15, '#a2bdce');
        rect(ctx, x + shift + 14, y + 9, 48, 2, '#c1d3d8');
      }
      // The terrace edge follows the world's walkable perimeter.
      rect(ctx, 28, 26, WORLD.width - 56, WORLD.height - 50, '#465b78');
      rect(ctx, 29, 26, WORLD.width - 58, WORLD.height - 60, '#8796a0');
      rect(ctx, 29, 26, WORLD.width - 58, WORLD.height - 66, '#d5d0b5');
      rect(ctx, 31, 28, WORLD.width - 62, WORLD.height - 71, '#e6dfc8');
      ctx.save(); ctx.beginPath(); ctx.rect(29, 27, WORLD.width - 58, WORLD.height - 54); ctx.clip();
      for (let y = 30; y < WORLD.height - 42; y += 16) for (let x = 32; x < WORLD.width - 32; x += 32) {
        const seed = hash(x, y);
        rect(ctx, x + (Math.floor((y - 30) / 16) % 2 ? 16 : 0), y, 30, 14, seed < .25 ? '#d8d3bf' : seed > .8 ? '#eee7cf' : '#e3dcc4');
        rect(ctx, x + 2, y, 26, 1, '#f5efd9');
        if (seed > .84) pixelLine(ctx, x + 5, y + 3, x + 17, y + 9, '#c7c5b5');
      }
      ctx.restore();
      for (const [x, y, w, h] of PATHS) {
        rect(ctx, x - 2, y - 2, w + 4, h + 4, '#b29660');
        rect(ctx, x - 1, y - 1, w + 2, h + 2, '#f2dfaa');
        rect(ctx, x, y, w, h, '#9eb2b7');
        for (let py = y + 2; py < y + h - 1; py += 12) for (let px = x + 2; px < x + w - 1; px += 16) {
          rect(ctx, px, py, Math.min(14, x + w - px), Math.min(10, y + h - py), '#b7c6c4');
          rect(ctx, px, py, Math.min(13, x + w - px), 1, '#d9e2d7');
        }
      }
      for (const basin of basinsFor(world)) {
        const { x, y, width:w, height:h, bridge:b } = basin;
        rect(ctx, x - 6, y - 6, w + 12, h + 13, '#778794');
        rect(ctx, x - 3, y - 3, w + 6, h + 7, '#f4e8c4');
        rect(ctx, x, y, w, h, '#3e6c99');
        rect(ctx, x + 3, y + 3, w - 6, 6, '#33577e');
        for (let cy = y + 21; cy < y + h - 8; cy += 38) for (let cx = x + 8; cx < x + w - 18; cx += 68) {
          const offset = Math.floor(hash(cx, cy) * 12);
          pixelOval(ctx, cx + offset, cy, Math.min(52, x + w - cx - offset), 11, '#7fa7bf');
          pixelOval(ctx, cx + offset + 8, cy - 4, Math.min(32, x + w - cx - offset - 8), 12, '#a3bdcb');
          rect(ctx, cx + offset + 10, cy + 8, Math.min(31, x + w - cx - offset - 10), 1, '#d0dbdc');
        }
        for (let px = x + 8; px < x + w; px += 24) { rect(ctx, px, y - 5, 9, 2, '#d3b779'); rect(ctx, px, y + h + 1, 9, 2, '#b9a273'); }
        // White stones and gold rails form an air bridge over the cloud gap.
        rect(ctx, b.x - 1, b.y + 3, b.width + 2, b.height, '#4d6c8c');
        rect(ctx, b.x, b.y, b.width, b.height, '#e9e2cc');
        for (let py = b.y + 4; py < b.y + b.height; py += 12) {
          rect(ctx, b.x + 3, py, b.width - 6, 1, '#afb8b1');
          rect(ctx, b.x + 4, py + 1, b.width - 8, 1, '#fff4d8');
        }
        for (const px of [b.x + 1, b.x + b.width - 3]) {
          rect(ctx, px, b.y, 2, b.height, '#bf9c53');
          for (let py = b.y + 3; py < b.y + b.height - 3; py += 24) {
            rect(ctx, px - 1, py - 4, 4, 10, '#eee7cd'); rect(ctx, px - 2, py - 5, 6, 2, '#dec587');
          }
        }
      }
      for (const [x, y] of ROCKS) {
        pixelOval(ctx, x - 3, y + 5, 27, 9, '#758b9350');
        pixelPolygon(ctx, [[x + 2,y + 10],[x,y + 3],[x + 5,y - 3],[x + 16,y - 1],[x + 21,y + 7],[x + 17,y + 11]], '#aaafa6');
        pixelPolygon(ctx, [[x + 1,y + 3],[x + 5,y - 3],[x + 16,y - 1],[x + 11,y + 5]], '#f5ebce');
        rect(ctx, x + 7, y, 2, 5, '#c7c7b6'); rect(ctx, x + 3, y + 9, 13, 1, '#dcceb0');
      }
    },
    prop(ctx, variant) {
      pixelOval(ctx, 9, 61, 36, 8, '#3f5a7350');
      rect(ctx, 15, 59, 22, 8, '#b09d77'); rect(ctx, 16, 58, 20, 3, '#f4e5bd');
      if (variant === 0) {
        rect(ctx, 19, 17, 14, 42, '#d8d8c8'); rect(ctx, 19, 18, 3, 39, '#fff1d0'); rect(ctx, 29, 18, 4, 39, '#a8b4b0');
        for (const x of [23, 27]) { rect(ctx, x, 21, 1, 32, '#a7b2ac'); rect(ctx, x + 1, 21, 1, 32, '#ece6cd'); }
        rect(ctx, 14, 11, 24, 7, '#d9bd7a'); rect(ctx, 13, 10, 26, 2, '#fff1c7'); rect(ctx, 16, 6, 20, 4, '#e4dfc5');
        pixelPolygon(ctx, [[16,7],[8,2],[11,12],[17,15]], '#faf0cf'); pixelPolygon(ctx, [[36,7],[44,2],[41,12],[35,15]], '#c8cebf');
      } else if (variant === 1) {
        rect(ctx, 24, 9, 4, 51, '#b4a16e'); rect(ctx, 25, 9, 1, 49, '#f9e3a8');
        pixelPolygon(ctx, [[28,11],[44,15],[40,33],[28,36]], '#537f9d');
        pixelPolygon(ctx, [[29,13],[40,16],[37,29],[29,32]], '#9dc3cc'); rect(ctx, 31, 18, 3, 8, '#e9d297');
        rect(ctx, 21, 5, 10, 5, '#d4b36b'); rect(ctx, 24, 2, 4, 4, '#fff1c3');
      } else if (variant === 2) {
        rect(ctx, 18, 34, 16, 25, '#d8d6c1'); rect(ctx, 19, 34, 3, 24, '#fff2d0'); rect(ctx, 29, 35, 4, 23, '#a2b1ac');
        pixelPolygon(ctx, [[15,34],[19,23],[23,28],[27,22],[35,34]], '#eee4c7');
        pixelPolygon(ctx, [[20,22],[25,13],[28,23],[24,29]], '#d0b578');
        rect(ctx, 17, 36, 18, 2, '#bc9f61'); rect(ctx, 23, 43, 2, 10, '#a6b2a8');
      } else {
        rect(ctx, 20, 37, 12, 22, '#b4c1ba'); rect(ctx, 20, 38, 3, 20, '#e7ebd7');
        pixelOval(ctx, 13, 17, 26, 23, '#b6a16f'); pixelOval(ctx, 15, 16, 22, 21, '#e7d19a');
        pixelOval(ctx, 18, 19, 16, 15, '#7099ad'); pixelOval(ctx, 21, 22, 10, 9, '#c7e3df');
        rect(ctx, 25, 22, 2, 8, '#fff2c5'); rect(ctx, 21, 26, 10, 1, '#f8e8bd');
        rect(ctx, 17, 38, 18, 3, '#eee2bb');
      }
    },
    landmark(ctx) {
      const x = 12, y = 24, w = HUT.width, h = HUT.height;
      rect(ctx, x - 4, y + h - 4, w + 8, 9, '#8d9e9b'); rect(ctx, x - 2, y + h - 4, w + 4, 3, '#d5bd80');
      rect(ctx, x, y + 18, w, h - 22, '#d0d8ce'); rect(ctx, x + 4, y + 19, w - 8, h - 24, '#eee7ce');
      pixelOval(ctx, x + 10, y - 16, w - 20, 44, '#7ca7b2'); pixelOval(ctx, x + 14, y - 17, w - 28, 37, '#b5d6d0');
      pixelLine(ctx, x + w / 2, y - 15, x + w / 2, y + 20, '#f7e7b6', 2);
      for (const dx of [23, w - 24]) pixelLine(ctx, x + w / 2, y - 14, x + dx, y + 20, '#87afb5');
      rect(ctx, x - 5, y + 18, w + 10, 7, '#b79e67'); rect(ctx, x - 4, y + 18, w + 8, 2, '#fff0c6');
      for (const dx of [5, w - 13]) { rect(ctx, x + dx, y + 27, 8, h - 31, '#b0bfba'); rect(ctx, x + dx, y + 27, 3, h - 31, '#fcf0d0'); rect(ctx, x + dx - 2, y + 25, 12, 3, '#e2c88d'); }
      rect(ctx, x + w / 2 - 13, y + 36, 26, h - 40, '#7094a2'); pixelOval(ctx, x + w / 2 - 13, y + 26, 26, 24, '#7094a2');
      rect(ctx, x + w / 2 - 10, y + 39, 20, h - 43, '#accac5'); rect(ctx, x + w / 2 - 8, y + 41, 2, h - 46, '#eef2dc');
      rect(ctx, x + w / 2 + 5, y + h - 19, 2, 4, '#ae884b');
      for (const dx of [21, w - 29]) { rect(ctx, x + dx, y + 36, 8, 15, '#8eafba'); rect(ctx, x + dx + 1, y + 37, 2, 11, '#d5e6d7'); }
      pixelPolygon(ctx, [[x + 2,y + 22],[x - 8,y + 9],[x - 4,y + 26],[x + 5,y + 30]], '#faf0ce');
      pixelPolygon(ctx, [[x + w - 2,y + 22],[x + w + 8,y + 9],[x + w + 4,y + 26],[x + w - 5,y + 30]], '#c6d0c3');
      rect(ctx, x + w / 2 - 17, y + h, 34, 3, '#f4e8c9'); rect(ctx, x + w / 2 - 20, y + h + 3, 40, 3, '#b7b59c');
    },
    barrier(ctx, log) {
      rect(ctx, 2, 7, log.width + 4, log.height + 3, '#9ba49c'); rect(ctx, 3, 3, log.width, log.height, '#e6dfc6');
      rect(ctx, 3, 3, log.width, 2, '#fff2d2'); rect(ctx, 5, 6, log.width - 4, 2, '#b8a375');
      for (let x = 6; x < log.width - 3; x += 12) rect(ctx, x, 5, 2, log.height - 2, '#c4c7b5');
    },
    guardian(ctx) {
      pixelOval(ctx, 7, 39, 27, 6, '#4a617d70');
      pixelPolygon(ctx, [[10,22],[5,33],[12,36],[16,22]], '#91b9bf'); pixelPolygon(ctx, [[28,22],[35,32],[28,36],[24,22]], '#678eaa');
      rect(ctx, 12, 20, 16, 16, '#eee6c9'); rect(ctx, 14, 22, 12, 10, '#f7efd9'); rect(ctx, 18, 21, 4, 13, '#b59b66');
      rect(ctx, 13, 34, 5, 8, '#667f92'); rect(ctx, 23, 34, 5, 8, '#526f88'); rect(ctx, 11, 41, 8, 3, '#bd9d60'); rect(ctx, 22, 41, 8, 3, '#bd9d60');
      pixelOval(ctx, 11, 4, 18, 17, '#d9c596'); rect(ctx, 12, 8, 16, 10, '#e9b98c'); rect(ctx, 11, 4, 18, 5, '#b7bba8');
      rect(ctx, 9, 8, 22, 5, '#a7874e'); rect(ctx, 12, 9, 6, 3, '#82c3cb'); rect(ctx, 22, 9, 6, 3, '#82c3cb'); rect(ctx, 14, 9, 2, 1, '#e8f2d9');
      rect(ctx, 18, 15, 5, 1, '#8e6754'); rect(ctx, 17, 19, 7, 3, '#527f9b');
    },
    gate(ctx, active) {
      pixelOval(ctx, 7, 43, 50, 14, '#718c9d'); pixelOval(ctx, 10, 42, 44, 11, '#e5dfc6');
      for (const x of [12, 45]) { rect(ctx, x, 12, 7, 34, '#acbdb7'); rect(ctx, x, 12, 2, 33, '#fff0c9'); rect(ctx, x - 2, 43, 11, 4, '#d6bb7a'); rect(ctx, x - 2, 10, 11, 4, '#e5cf96'); }
      pixelPolygon(ctx, [[15,15],[3,6],[5,17],[15,24]], '#faf0d0'); pixelPolygon(ctx, [[49,15],[61,6],[59,17],[49,24]], '#ccd9cd');
      rect(ctx, 17, 7, 30, 5, '#d3b273'); rect(ctx, 22, 4, 20, 3, '#f5e3ae');
      pixelOval(ctx, 24, 13, 16, 30, active ? '#9beadd' : '#567e96'); pixelOval(ctx, 27, 17, 10, 23, active ? '#d5fff0' : '#83a8b1');
      if (!active) { rect(ctx, 30, 21, 4, 14, '#d9bc7c'); rect(ctx, 26, 25, 12, 4, '#d9bc7c'); }
      rect(ctx, 20, 47, 24, 2, active ? '#baffdc' : '#dac28c');
    },
  });
}

/** An underwater shell sanctuary: pearl paths, coral fans and a nautilus hall. */
export function createCoralArt(world) {
  const { WORLD, PATHS, HUT, ROCKS } = world;
  return buildBiomeScene(world, {
    ground(ctx) {
      rect(ctx, 0, 0, WORLD.width, WORLD.height, '#123f59');
      rect(ctx, 29, 27, WORLD.width - 58, WORLD.height - 54, '#397f85');
      ctx.save(); ctx.beginPath(); ctx.rect(29, 27, WORLD.width - 58, WORLD.height - 54); ctx.clip();
      for (let y = 28; y < WORLD.height - 27; y += 8) for (let x = 30; x < WORLD.width - 29; x += 8) {
        const seed = hash(x, y), broad = hash(Math.floor(x / 56), Math.floor(y / 48));
        rect(ctx, x, y, 8, 8, seed + broad > 1.25 ? '#5c9d98' : seed + broad < .6 ? '#32767f' : '#438a8b');
        if (seed > .92) { rect(ctx, x + 2, y + 3, 3, 1, '#9dc7af'); rect(ctx, x + 3, y + 2, 1, 3, '#80b4a7'); }
      }
      ctx.restore();
      for (const [x, y, w, h] of PATHS) {
        rect(ctx, x - 2, y - 2, w + 4, h + 4, '#296b7b'); rect(ctx, x, y, w, h, '#9dc5bc');
        for (let py = y + 1; py < y + h; py += 12) for (let px = x + 1; px < x + w; px += 16) {
          const tw = Math.min(14, x + w - px), th = Math.min(10, y + h - py);
          rect(ctx, px, py, tw, th, '#c9d8bd'); rect(ctx, px + 1, py, Math.max(1, tw - 2), 2, '#e2e7cd');
          if (tw > 5 && th > 4) rect(ctx, px + 3, py + 4, 4, 1, '#a6bda9');
        }
      }
      for (const basin of basinsFor(world)) {
        const { x, y, width:w, height:h, bridge:b } = basin;
        rect(ctx, x - 7, y - 7, w + 14, h + 15, '#629e99'); rect(ctx, x - 4, y - 4, w + 8, h + 9, '#284f69');
        rect(ctx, x, y, w, h, '#13374f'); rect(ctx, x + 5, y + 4, w - 10, h - 8, '#1c4b63');
        for (let py = y + 12; py < y + h - 7; py += 16) for (let px = x + 11; px < x + w - 8; px += 24) {
          const seed = hash(px, py);
          rect(ctx, px, py, 7 + Math.floor(seed * 6), 1, seed > .65 ? '#467e89' : '#2b6175');
          if (seed > .83) { pixelOval(ctx, px + 5, py - 6, 4, 5, '#7fbdbb'); rect(ctx, px + 6, py - 6, 1, 1, '#c5e0ca'); }
        }
        for (let px = x + 4; px < x + w - 6; px += 16) { rect(ctx, px, y - 3, 8, 2, '#8cb5aa'); rect(ctx, px + 2, y + h + 1, 7, 2, '#315f70'); }
        rect(ctx, b.x - 2, b.y + 3, b.width + 4, b.height, '#17455c'); rect(ctx, b.x, b.y, b.width, b.height, '#d5cfb9');
        for (let py = b.y + 3; py < b.y + b.height; py += 12) {
          rect(ctx, b.x + 2, py, b.width - 4, 8, '#ece0c4'); rect(ctx, b.x + 3, py + 7, b.width - 6, 1, '#aeaeb0');
          rect(ctx, b.x + b.width / 2 - 2, py + 2, 4, 3, '#ba91a5');
        }
        for (const px of [b.x, b.x + b.width - 2]) { rect(ctx, px, b.y, 2, b.height, '#729e9e'); for (let py = b.y; py < b.y + b.height; py += 24) pixelOval(ctx, px - 2, py, 6, 7, '#e3c9bb'); }
      }
      for (const [x, y] of ROCKS) {
        pixelOval(ctx, x - 3, y + 5, 28, 9, '#174f6450');
        pixelPolygon(ctx, [[x,y + 8],[x + 1,y],[x + 8,y - 4],[x + 19,y],[x + 21,y + 8],[x + 15,y + 12]], '#798f99');
        pixelPolygon(ctx, [[x + 1,y],[x + 8,y - 4],[x + 18,y],[x + 11,y + 5]], '#b7bdba');
        rect(ctx, x + 3, y + 4, 3, 3, '#ce9da3'); rect(ctx, x + 5, y + 3, 1, 5, '#e1b5ad'); rect(ctx, x + 14, y + 5, 5, 2, '#697e90');
      }
      // Narrow, static shafts hint at water above without hiding game objects.
      for (const x of [112, 352, 624]) {
        pixelPolygon(ctx, [[x,28],[x + 10,28],[x - 90,482],[x - 126,482]], '#c6e9d40a');
        pixelPolygon(ctx, [[x + 12,28],[x + 15,28],[x - 72,482],[x - 88,482]], '#c6e9d409');
      }
    },
    prop(ctx, variant) {
      pixelOval(ctx, 7, 60, 38, 9, '#17455e65'); rect(ctx, 19, 59, 14, 8, '#62958d');
      if (variant === 0) {
        pixelLine(ctx, 26, 63, 25, 21, '#9e677e', 6); pixelLine(ctx, 25, 46, 12, 35, '#b77a8d', 5); pixelLine(ctx, 13, 36, 10, 23, '#c98e9b', 4);
        pixelLine(ctx, 25, 38, 38, 27, '#bc8294', 5); pixelLine(ctx, 38, 28, 40, 14, '#d5a0a7', 4); pixelLine(ctx, 25, 29, 19, 13, '#c58a99', 4);
        pixelLine(ctx, 28, 58, 35, 44, '#ad7290', 4); pixelLine(ctx, 35, 44, 43, 39, '#c78e9e', 3);
        for (const [x, y] of [[10,22],[19,12],[25,20],[40,13],[43,38]]) { pixelOval(ctx, x - 3, y - 3, 7, 6, '#e3b0b0'); rect(ctx, x - 1, y - 2, 2, 2, '#f4d4bd'); }
      } else if (variant === 1) {
        rect(ctx, 22, 40, 8, 23, '#698e96');
        pixelOval(ctx, 7, 20, 38, 28, '#675d8b'); pixelOval(ctx, 10, 17, 32, 26, '#ab88b6');
        for (let x = 12; x < 41; x += 5) pixelLine(ctx, x, 23, 26, 42, '#735b95', 2);
        pixelOval(ctx, 14, 23, 24, 15, '#c2a2c6'); pixelOval(ctx, 18, 26, 16, 10, '#80b8b6'); pixelOval(ctx, 22, 28, 8, 6, '#d9e3c7');
        rect(ctx, 23, 50, 2, 11, '#a4bca9'); rect(ctx, 29, 49, 2, 11, '#465e7b');
      } else if (variant === 2) {
        pixelLine(ctx, 25, 63, 21, 13, '#2d7777', 4); pixelLine(ctx, 28, 62, 33, 20, '#3b8f89', 4);
        for (let i = 0; i < 5; i++) {
          const y = 17 + i * 8;
          pixelPolygon(ctx, [[22,y + 3],[12,y - 1],[8,y + 2],[21,y + 9]], i % 2 ? '#67ac98' : '#8fc0a3');
          pixelPolygon(ctx, [[32,y + 5],[42,y],[44,y + 4],[31,y + 12]], i % 2 ? '#5ca895' : '#83bda0');
        }
        pixelOval(ctx, 18, 5, 7, 10, '#a9d0ad'); pixelOval(ctx, 30, 13, 8, 10, '#83beaa');
      } else {
        rect(ctx, 22, 38, 8, 25, '#799e99');
        pixelPolygon(ctx, [[25,43],[9,32],[6,14],[12,9],[24,23],[35,7],[43,11],[43,30]], '#8d739b');
        for (const [x, y] of [[10,15],[15,14],[20,23],[25,31],[32,21],[37,12],[41,16]]) pixelLine(ctx, 26, 42, x, y, '#c0a5b5');
        pixelOval(ctx, 18, 51, 17, 12, '#b8bdad'); pixelOval(ctx, 21, 51, 10, 9, '#e6cdb8');
      }
      rect(ctx, 17, 64, 21, 2, '#8cb2a1');
    },
    landmark(ctx) {
      const x = 12, y = 24, w = HUT.width, h = HUT.height;
      rect(ctx, x - 4, y + h - 4, w + 8, 10, '#477783'); rect(ctx, x, y + 27, w, h - 30, '#9eb8ad');
      rect(ctx, x + 3, y + 29, w - 6, h - 34, '#d1cdb9');
      // The large coiled shell is a recognizable silhouette above the hall.
      pixelOval(ctx, x - 8, y - 17, w + 16, 69, '#8a7d95'); pixelOval(ctx, x - 5, y - 19, w + 10, 65, '#c9a5ae');
      pixelOval(ctx, x + 1, y - 15, w - 2, 54, '#e0b8b7');
      for (let i = 0; i < 7; i++) pixelLine(ctx, x + 28, y + 28, x + 5 + i * 12, y - 4 + Math.abs(3 - i) * 5, '#b78f9f', 2);
      pixelOval(ctx, x + 31, y - 9, 48, 43, '#a9829d'); pixelOval(ctx, x + 35, y - 6, 40, 35, '#e6c8be');
      pixelOval(ctx, x + 41, y - 2, 29, 26, '#a88ba4'); pixelOval(ctx, x + 46, y + 2, 20, 18, '#ddc9bd');
      pixelOval(ctx, x + 49, y + 5, 12, 11, '#8b849d'); pixelOval(ctx, x + 52, y + 7, 6, 5, '#b9d2bd');
      for (const dx of [2, w - 12]) { rect(ctx, x + dx, y + 41, 10, h - 44, '#729e9c'); rect(ctx, x + dx + 1, y + 42, 3, h - 46, '#d4dac0'); pixelOval(ctx, x + dx - 2, y + 35, 14, 10, '#e9c7b8'); }
      pixelOval(ctx, x + 25, y + 31, 38, 35, '#4a7789'); rect(ctx, x + 25, y + 48, 38, h - 52, '#4a7789');
      pixelOval(ctx, x + 30, y + 37, 28, 25, '#7bb2b2'); rect(ctx, x + 30, y + 50, 28, h - 54, '#75a6a7');
      rect(ctx, x + 35, y + 43, 2, h - 48, '#c0dbca'); rect(ctx, x + 49, y + h - 17, 3, 3, '#e2c5a1');
      rect(ctx, x + 19, y + h, 51, 3, '#ded9c0'); rect(ctx, x + 15, y + h + 3, 59, 3, '#94aaa3');
    },
    barrier(ctx, log) {
      pixelOval(ctx, 0, 7, log.width + 8, log.height + 2, '#1e53655a');
      rect(ctx, 3, 3, log.width, log.height, '#aeaaa9'); rect(ctx, 5, 3, log.width - 4, 3, '#dcc9bb');
      for (let x = 7; x < log.width; x += 8) { rect(ctx, x, 5, 2, log.height - 2, '#908fa3'); rect(ctx, x + 1, 5, 1, 3, '#e9d5bf'); }
      pixelOval(ctx, 1, 4, 6, log.height - 1, '#83b2a5');
    },
    guardian(ctx) {
      pixelOval(ctx, 6, 40, 28, 5, '#154b6370');
      pixelPolygon(ctx, [[12,20],[4,31],[8,36],[15,28]], '#64aaa6'); pixelPolygon(ctx, [[28,20],[36,31],[31,35],[25,28]], '#4d939e');
      rect(ctx, 12, 20, 16, 15, '#708f9a'); rect(ctx, 15, 23, 10, 9, '#d2b697'); rect(ctx, 19, 24, 3, 5, '#a8ded0');
      rect(ctx, 12, 34, 6, 8, '#4f7b8d'); rect(ctx, 23, 34, 6, 8, '#416d83'); pixelOval(ctx, 9, 40, 11, 4, '#c2b7a5'); pixelOval(ctx, 22, 40, 11, 4, '#acb3a4');
      pixelOval(ctx, 11, 4, 19, 17, '#819aab'); pixelOval(ctx, 14, 7, 13, 12, '#a6d0c1'); rect(ctx, 16, 11, 2, 2, '#245269'); rect(ctx, 23, 11, 2, 2, '#245269');
      rect(ctx, 18, 16, 5, 1, '#648c91');
      pixelPolygon(ctx, [[11,12],[6,3],[13,6],[17,3],[20,7],[25,2],[31,4],[28,13]], '#c9a4b6'); rect(ctx, 13, 7, 14, 2, '#e4c5be');
      rect(ctx, 33, 19, 2, 23, '#a8b8a8'); pixelOval(ctx, 30, 14, 8, 9, '#98cfbf'); rect(ctx, 32, 15, 2, 3, '#d3edcf');
    },
    gate(ctx, active) {
      pixelOval(ctx, 4, 43, 56, 15, '#466c80'); pixelOval(ctx, 7, 42, 50, 12, '#c5c5b6');
      pixelPolygon(ctx, [[11,45],[5,29],[9,15],[17,8],[25,4],[32,10],[39,4],[47,8],[55,17],[59,31],[53,45]], '#a782a1');
      pixelPolygon(ctx, [[13,43],[9,28],[13,17],[20,12],[27,10],[32,16],[37,10],[45,12],[52,20],[55,31],[51,43]], '#dbb8b6');
      for (const [x, y] of [[12,18],[19,12],[27,10],[37,10],[45,12],[52,20]]) pixelLine(ctx, 32, 43, x, y, '#b18d9f', 2);
      pixelOval(ctx, 19, 26, 26, 23, '#5a8e9d'); pixelOval(ctx, 23, 28, 18, 18, active ? '#b9efd9' : '#899faf');
      pixelOval(ctx, 26, 30, 10, 10, active ? '#ecffe4' : '#b8c2ba');
      rect(ctx, 13, 46, 38, 3, '#e6d4bf'); rect(ctx, 19, 48, 26, 2, active ? '#8be5ca' : '#7f9e9f');
    },
  });
}
