import { rect, hash } from './pixel-utils.js';
import { buildBiomeScene, pixelPolygon, pixelOval, pixelLine } from './biome-paint.js';

function text(ctx, value, x, y, color, size = 7) {
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText(value, x, y);
}

function neonProp(ctx, variant) {
  pixelOval(ctx, 9, 61, 36, 7, '#07152288');
  if (variant === 0) {
    // A narrow arcade frontage, with a deep marquee rather than a tree canopy.
    rect(ctx, 15, 17, 24, 47, '#10172b'); rect(ctx, 17, 19, 20, 43, '#354059');
    rect(ctx, 16, 16, 23, 3, '#e84bab'); rect(ctx, 18, 17, 19, 1, '#ffd0ed');
    rect(ctx, 13, 12, 28, 5, '#171f36'); rect(ctx, 15, 12, 24, 2, '#9b4db1');
    for (let y = 25; y < 52; y += 9) {
      rect(ctx, 20, y, 5, 5, '#14283d'); rect(ctx, 29, y, 5, 5, '#14283d');
      rect(ctx, 20, y, 4, 2, '#73d4d0'); rect(ctx, 29, y, 4, 2, '#d56fba');
    }
    rect(ctx, 23, 53, 9, 11, '#112334'); rect(ctx, 24, 54, 6, 7, '#61b3bc');
    rect(ctx, 12, 29, 5, 23, '#3d2848'); rect(ctx, 12, 29, 2, 23, '#e76bb7');
    for (let y = 33; y < 49; y += 5) rect(ctx, 14, y, 2, 2, '#efb4d5');
    rect(ctx, 14, 63, 26, 3, '#63728b');
  } else if (variant === 1) {
    // Glass vending cabinet: bright product rows sit above a solid plinth.
    rect(ctx, 15, 28, 24, 37, '#101f32'); rect(ctx, 17, 30, 20, 32, '#39526a');
    rect(ctx, 18, 33, 14, 19, '#0d1a2e'); rect(ctx, 19, 34, 12, 2, '#5a8597');
    for (let y = 38; y < 51; y += 6) for (let x = 20; x < 31; x += 4) {
      rect(ctx, x, y, 2, 3, (x + y) % 3 ? '#7ccdc6' : '#df79bd');
    }
    rect(ctx, 34, 36, 2, 10, '#58c9d5'); rect(ctx, 34, 48, 2, 2, '#e8b8db');
    rect(ctx, 20, 56, 11, 3, '#172d41'); rect(ctx, 15, 28, 24, 2, '#62c9cf');
    rect(ctx, 13, 63, 28, 3, '#536579'); text(ctx, 'SODA', 26, 25, '#9bded6', 6);
  } else if (variant === 2) {
    // Streetlight with an attached sign, preserving the narrow trunk collider.
    rect(ctx, 23, 21, 5, 43, '#182f40'); rect(ctx, 24, 22, 2, 40, '#647389');
    rect(ctx, 16, 18, 24, 4, '#344963'); rect(ctx, 17, 19, 21, 1, '#91c9d4');
    rect(ctx, 35, 22, 6, 5, '#273e50'); rect(ctx, 35, 25, 6, 2, '#abf3dd');
    rect(ctx, 10, 31, 14, 19, '#37213f'); rect(ctx, 11, 32, 12, 17, '#bb4b9f');
    rect(ctx, 12, 34, 9, 1, '#f7a7d9'); rect(ctx, 14, 37, 4, 7, '#f5c4e6');
    rect(ctx, 12, 45, 9, 1, '#e986c8'); rect(ctx, 19, 63, 13, 3, '#465f72');
  } else {
    // A rooftop air unit and its rooftop aerial form a broader stepped silhouette.
    rect(ctx, 13, 43, 28, 21, '#14243a'); rect(ctx, 15, 44, 24, 18, '#46576b');
    for (let x = 18; x < 37; x += 4) rect(ctx, x, 48, 2, 10, '#1b3346');
    rect(ctx, 17, 41, 21, 4, '#778596'); rect(ctx, 28, 26, 2, 15, '#91a5af');
    rect(ctx, 22, 30, 15, 2, '#71889a'); rect(ctx, 28, 25, 3, 2, '#ee8bc9');
    rect(ctx, 12, 63, 30, 3, '#2a4255'); rect(ctx, 16, 59, 22, 1, '#9d718b');
  }
}

export function createNeonArt(world) {
  const { WORLD, PATHS, BASINS, HUT, ROCKS } = world;
  return buildBiomeScene(world, {
    ground(ctx) {
      rect(ctx, 0, 0, WORLD.width, WORLD.height, '#152236');
      // Wet paving: small offset bricks and narrow reflections, not factory panels.
      for (let y = 0; y < WORLD.height; y += 12) for (let x = -12; x < WORLD.width; x += 24) {
        const px = x + (y % 24 ? 12 : 0), n = hash(px, y);
        rect(ctx, px + 1, y + 1, 23, 11, n < .3 ? '#203148' : n > .7 ? '#263950' : '#23344a');
        if (n > .88) { rect(ctx, px + 4, y + 8, 14, 1, '#5c4c70'); rect(ctx, px + 6, y + 9, 10, 1, '#374d67'); }
      }
      for (const [x, y, w, h] of PATHS) {
        rect(ctx, x - 2, y - 2, w + 4, h + 4, '#576476'); rect(ctx, x, y, w, h, '#1b283b');
        rect(ctx, x, y, w, 1, '#8a8a96'); rect(ctx, x, y + h - 1, w, 1, '#344d66');
        if (w > h) {
          for (let px = x + 12; px < x + w - 6; px += 35) rect(ctx, px, y + h / 2, 15, 1, '#668798');
          for (let px = x + 6; px < x + w - 5; px += 54) { rect(ctx, px, y + 3, 16, 1, '#375b72'); rect(ctx, px + 5, y + 5, 11, 1, '#533d65'); }
        } else for (let py = y + 10; py < y + h - 5; py += 35) rect(ctx, x + w / 2, py, 1, 15, '#668798');
      }
      for (const basin of BASINS) {
        const { x, y, width:w, height:h, bridge:b } = basin;
        rect(ctx, x - 5, y - 5, w + 10, h + 10, '#526477'); rect(ctx, x - 2, y - 2, w + 4, h + 4, '#6a6c87');
        rect(ctx, x, y, w, h, '#081e34'); rect(ctx, x + 3, y + 3, w - 6, h - 6, '#112c44');
        for (let py = y + 8; py < y + h - 5; py += 9) for (let px = x + 6; px < x + w - 12; px += 22) {
          const n = hash(px, py); rect(ctx, px, py, 5 + Math.floor(n * 9), 1, n > .7 ? '#587092' : '#22475b');
          if (n > .88) rect(ctx, px + 4, py + 2, 9, 1, '#823d72');
        }
        rect(ctx, b.x - 3, b.y + 3, b.width + 6, b.height, '#091b2c');
        rect(ctx, b.x, b.y, b.width, b.height, '#5d637c'); rect(ctx, b.x + 3, b.y, b.width - 6, b.height, '#2b4057');
        for (let py = b.y + 3; py < b.y + b.height; py += 8) { rect(ctx, b.x + 5, py, b.width - 10, 2, '#567183'); rect(ctx, b.x + 6, py + 2, b.width - 12, 1, '#142d44'); }
        rect(ctx, b.x, b.y, 2, b.height, '#67d2d3'); rect(ctx, b.x + b.width - 2, b.y, 2, b.height, '#c878c4');
      }
      for (const [x, y] of ROCKS) {
        rect(ctx, x + 1, y + 6, 22, 6, '#0e1f31'); rect(ctx, x + 3, y + 2, 14, 8, '#455367');
        rect(ctx, x + 5, y, 11, 3, '#738091'); rect(ctx, x + 6, y + 3, 7, 2, '#293a50');
        rect(ctx, x + 16, y + 5, 4, 4, '#59516b'); rect(ctx, x + 2, y + 9, 8, 1, '#90779b');
      }
      for (const y of [26, 486]) { rect(ctx, 29, y, 710, 2, '#67557a'); rect(ctx, 29, y + 2, 710, 1, '#143949'); }
      // A sheltered entrance mat remains inside the solid building footprint.
      rect(ctx, HUT.x + 21, HUT.y + HUT.height, HUT.width - 42, 3, '#6d5a7d');
    },
    prop:neonProp,
    landmark(ctx) {
      const x = 12, y = 24, w = HUT.width, h = HUT.height;
      rect(ctx, x - 3, y + 9, w + 6, h - 9, '#142339'); rect(ctx, x, y + 12, w, h - 12, '#465267');
      for (let py = y + 20; py < y + h; py += 10) rect(ctx, x + 1, py, w - 2, 1, '#293c51');
      rect(ctx, x - 4, y, w + 8, 14, '#21243c'); rect(ctx, x - 3, y + 2, w + 6, 2, '#d66fbc');
      rect(ctx, x + 3, y + 4, w - 6, 8, '#312b4b'); text(ctx, 'NIGHT METRO', x + w / 2, y + 10, '#acdeda', 7);
      for (const px of [x + 7, x + w - 30]) {
        rect(ctx, px, y + 25, 23, 25, '#15293c'); rect(ctx, px + 2, y + 27, 19, 20, '#4a93a3');
        rect(ctx, px + 4, y + 28, 3, 17, '#9ddbd4'); rect(ctx, px + 12, y + 27, 2, 20, '#263b59');
        rect(ctx, px, y + 49, 23, 3, '#b56d9d');
      }
      rect(ctx, x + w / 2 - 9, y + 31, 18, h - 31, '#14263b'); rect(ctx, x + w / 2 - 6, y + 34, 12, h - 37, '#515b7b');
      rect(ctx, x + w / 2 - 4, y + 37, 2, 19, '#88d5d1'); rect(ctx, x + w / 2 + 5, y + 53, 2, 4, '#dc9dcb');
      rect(ctx, x - 3, y + h - 3, w + 6, 3, '#718091'); rect(ctx, x + 8, y - 9, 24, 9, '#283b51');
      for (let px = x + 10; px < x + 30; px += 5) rect(ctx, px, y - 6, 2, 4, '#64748b');
    },
    barrier(ctx, log) {
      rect(ctx, 3, 3, log.width, log.height, '#21374d'); rect(ctx, 3, 3, log.width, 2, '#78929f');
      rect(ctx, 5, 6, log.width - 4, 2, '#a2659e');
      for (let x = 7; x < log.width; x += 9) rect(ctx, x, 5, 2, 5, '#102a3e');
    },
    guardian(ctx) {
      rect(ctx, 11, 35, 7, 8, '#15253b'); rect(ctx, 23, 35, 7, 8, '#15253b');
      rect(ctx, 10, 40, 9, 3, '#7297a6'); rect(ctx, 22, 40, 9, 3, '#7297a6');
      pixelPolygon(ctx, [[10,19],[30,19],[32,35],[26,39],[14,39],[8,35]], '#38536d');
      rect(ctx, 11, 21, 6, 14, '#a25d9d'); rect(ctx, 18, 22, 7, 10, '#162f46');
      rect(ctx, 20, 23, 2, 7, '#9aded3'); rect(ctx, 6, 22, 4, 12, '#6d7a95'); rect(ctx, 31, 22, 4, 12, '#6d7a95');
      rect(ctx, 12, 7, 17, 14, '#1b2b43'); rect(ctx, 14, 8, 13, 12, '#b78ba3');
      rect(ctx, 10, 4, 21, 6, '#405c75'); rect(ctx, 11, 8, 19, 2, '#8fd5cf'); rect(ctx, 15, 12, 10, 3, '#273851');
      rect(ctx, 16, 12, 7, 1, '#dbb1d7'); rect(ctx, 18, 18, 5, 1, '#675075');
    },
    gate(ctx, active) {
      rect(ctx, 9, 43, 46, 9, '#182d43'); rect(ctx, 13, 43, 38, 3, '#7b7f9e');
      for (const x of [11, 46]) { rect(ctx, x, 10, 7, 35, '#283f59'); rect(ctx, x + 2, 12, 2, 29, active ? '#98e4d4' : '#7b619a'); }
      rect(ctx, 13, 6, 38, 7, '#242941'); rect(ctx, 14, 7, 36, 2, active ? '#8ee2d4' : '#ce76bc');
      if (active) { rect(ctx, 22, 16, 20, 26, '#62c5c218'); for (let y = 18; y < 42; y += 6) rect(ctx, 23, y, 18, 1, '#8de4dc55'); }
      text(ctx, active ? 'DEPART' : 'METRO', 32, 64, active ? '#b1f6e5' : '#dab6e1');
    },
  });
}

function lunarProp(ctx, variant) {
  pixelOval(ctx, 8, 61, 37, 7, '#131c2c55');
  if (variant === 0) {
    rect(ctx, 23, 39, 6, 25, '#3e5162'); rect(ctx, 24, 40, 2, 22, '#b5bec4');
    pixelPolygon(ctx, [[4,29],[34,24],[47,38],[17,44]], '#263449');
    pixelPolygon(ctx, [[6,29],[33,26],[44,37],[18,41]], '#3e587a');
    for (let i = 0; i < 4; i++) pixelLine(ctx, 11 + i * 7, 29 - i, 21 + i * 7, 40 - i, '#8aacc0');
    pixelLine(ctx, 11, 35, 39, 30, '#92b4c5'); rect(ctx, 19, 63, 15, 3, '#73828f');
  } else if (variant === 1) {
    rect(ctx, 22, 30, 8, 34, '#536579'); rect(ctx, 24, 31, 3, 31, '#a5b4bd');
    rect(ctx, 17, 26, 18, 10, '#293f55'); rect(ctx, 19, 28, 14, 6, '#b2bcc1');
    rect(ctx, 21, 28, 10, 2, '#8bc3c9'); rect(ctx, 25, 8, 2, 19, '#c3ccd0');
    pixelLine(ctx, 11, 12, 26, 21, '#889aa9', 2); pixelLine(ctx, 41, 12, 26, 21, '#889aa9', 2);
    pixelLine(ctx, 12, 11, 40, 11, '#d0d3cf', 2); rect(ctx, 25, 7, 2, 2, '#8cdbcf');
    rect(ctx, 17, 63, 19, 3, '#6b7b89');
  } else if (variant === 2) {
    rect(ctx, 15, 28, 23, 35, '#304258'); rect(ctx, 18, 26, 17, 38, '#a4b0ba');
    pixelOval(ctx, 18, 24, 17, 9, '#c6cdd0'); pixelOval(ctx, 18, 59, 17, 7, '#6f8290');
    rect(ctx, 20, 32, 3, 23, '#c6d0d2'); rect(ctx, 29, 33, 3, 22, '#778d9d');
    rect(ctx, 18, 43, 17, 6, '#4c7083'); rect(ctx, 21, 44, 9, 2, '#9fd4d2');
    rect(ctx, 24, 18, 5, 7, '#728895'); rect(ctx, 20, 17, 13, 3, '#bec6c8');
  } else {
    rect(ctx, 19, 44, 16, 20, '#6d8291'); rect(ctx, 21, 45, 12, 15, '#c5ccca');
    rect(ctx, 23, 49, 8, 6, '#304a60'); rect(ctx, 24, 50, 5, 2, '#95d4d3');
    rect(ctx, 12, 37, 29, 9, '#374e64'); rect(ctx, 13, 37, 27, 2, '#cad0cb');
    rect(ctx, 24, 22, 4, 15, '#a9b5bd'); pixelPolygon(ctx, [[14,23],[25,14],[39,22],[31,32]], '#90a6b4');
    pixelPolygon(ctx, [[17,23],[26,17],[36,22],[30,28]], '#d1d6d2'); rect(ctx, 29, 24, 2, 12, '#40596e');
    rect(ctx, 15, 63, 24, 3, '#586d7e');
  }
}

export function createLunarArt(world) {
  const { WORLD, PATHS, BASINS, HUT, ROCKS } = world;
  const onPath = (x, y) => PATHS.some(([px, py, w, h]) => x >= px - 8 && x <= px + w + 8 && y >= py - 8 && y <= py + h + 8);
  return buildBiomeScene(world, {
    ground(ctx) {
      rect(ctx, 0, 0, WORLD.width, WORLD.height, '#111b2c');
      for (let y = 0; y < WORLD.height; y += 13) for (let x = 0; x < WORLD.width; x += 17) if (hash(x + 3, y) > .94) rect(ctx, x, y, 1, 1, '#b4bfcb');
      rect(ctx, 29, 27, WORLD.width - 58, WORLD.height - 54, '#7d8792');
      for (let y = 28; y < WORLD.height - 27; y += 4) for (let x = 30; x < WORLD.width - 29; x += 4) {
        const n = hash(x, y) * .4 + hash(Math.floor(x / 32), Math.floor(y / 32)) * .6;
        rect(ctx, x, y, 4, 4, n > .65 ? '#8e969e' : n < .32 ? '#707f8e' : '#818c97');
      }
      for (let y = 62; y < WORLD.height - 50; y += 43) for (let x = 61; x < WORLD.width - 50; x += 53) {
        const n = hash(x, y); if (n < .53 || onPath(x, y)) continue;
        const width = 12 + Math.floor(n * 16), height = Math.floor(width * .55);
        pixelOval(ctx, x, y, width, height, '#647687'); pixelOval(ctx, x + 2, y + 1, width - 4, height - 3, '#778795');
        pixelLine(ctx, x + 4, y + height - 2, x + width - 5, y + height - 2, '#a2a9ae');
      }
      for (const [x, y, w, h] of PATHS) {
        rect(ctx, x - 2, y - 2, w + 4, h + 4, '#687b8b'); rect(ctx, x, y, w, h, '#a0a8ac');
        for (let py = y + 3; py < y + h; py += 6) for (let px = x + 4; px < x + w; px += 10) if (hash(px, py) > .55) rect(ctx, px, py, 4, 1, '#89979f');
        if (w > h) for (let px = x + 8; px < x + w - 4; px += 30) { rect(ctx, px, y + 2, 8, 1, '#d3c8a3'); rect(ctx, px, y + h - 3, 8, 1, '#d3c8a3'); }
        else for (let py = y + 8; py < y + h - 4; py += 30) { rect(ctx, x + 2, py, 1, 8, '#d3c8a3'); rect(ctx, x + w - 3, py, 1, 8, '#d3c8a3'); }
      }
      for (const basin of BASINS) {
        const { x, y, width:w, height:h, bridge:b } = basin;
        rect(ctx, x - 5, y - 5, w + 10, h + 10, '#c0c5c4'); rect(ctx, x - 3, y - 3, w + 6, h + 6, '#536b7e');
        rect(ctx, x, y, w, h, '#17273a'); rect(ctx, x + 5, y + 5, w - 10, h - 10, '#0b182b');
        for (let py = y + 7; py < y + h - 5; py += 19) for (let px = x + 7; px < x + w - 5; px += 23) if (hash(px, py) > .89) rect(ctx, px, py, 1, 1, '#5b809e');
        for (let px = x + 9; px < x + w - 5; px += 32) { rect(ctx, px, y + h - 3, 19, 3, '#304559'); rect(ctx, px + 3, y + h - 6, 8, 3, '#283d52'); }
        rect(ctx, b.x - 3, b.y, b.width + 6, b.height, '#263e53'); rect(ctx, b.x, b.y, b.width, b.height, '#9daeb8');
        rect(ctx, b.x + 4, b.y, b.width - 8, b.height, '#526c81');
        for (let py = b.y + 4; py < b.y + b.height; py += 7) { rect(ctx, b.x + 5, py, b.width - 10, 1, '#c1cecf'); rect(ctx, b.x + 6, py + 2, b.width - 12, 2, '#344e66'); }
        for (const px of [b.x, b.x + b.width - 2]) for (let py = b.y + 3; py < b.y + b.height - 2; py += 24) rect(ctx, px, py, 2, 7, '#a0d8d5');
      }
      for (const [x, y] of ROCKS) {
        pixelOval(ctx, x - 1, y + 6, 24, 8, '#536879');
        pixelPolygon(ctx, [[x+2,y+9],[x+3,y+3],[x+10,y],[x+17,y+4],[x+19,y+10]], '#8b9aa4');
        pixelPolygon(ctx, [[x+4,y+4],[x+10,y+1],[x+15,y+4],[x+10,y+7]], '#c0c6c5');
        rect(ctx, x + 14, y + 7, 4, 3, '#61798d');
      }
    },
    prop:lunarProp,
    landmark(ctx) {
      const x = 12, y = 24, w = HUT.width, h = HUT.height;
      rect(ctx, x - 3, y + 15, w + 6, h - 15, '#3f566b'); rect(ctx, x, y + 14, w, h - 14, '#a2afb6');
      pixelOval(ctx, x - 3, y - 5, w + 6, 49, '#3b5269'); pixelOval(ctx, x, y - 4, w, 42, '#c1c9c9');
      pixelOval(ctx, x + 7, y, w - 14, 31, '#97adba');
      for (let i = 1; i < 5; i++) pixelLine(ctx, x + w / 2, y - 3, x + i * w / 5, y + 31, '#d8dbd4', 2);
      rect(ctx, x, y + 30, w, 4, '#526f82');
      for (const px of [x + 7, x + w - 27]) { rect(ctx, px, y + 42, 20, 11, '#304c65'); rect(ctx, px + 2, y + 43, 16, 6, '#a7d5d3'); rect(ctx, px + 8, y + 42, 2, 11, '#607c90'); }
      rect(ctx, x + w / 2 - 11, y + 38, 22, h - 38, '#344d64'); rect(ctx, x + w / 2 - 8, y + 41, 16, h - 42, '#718e9f');
      rect(ctx, x + w / 2 - 5, y + 44, 10, 8, '#a6d5d3'); rect(ctx, x + w / 2 + 6, y + 59, 2, 5, '#d5d5b8');
      rect(ctx, x - 2, y + h - 4, w + 4, 4, '#617d90'); text(ctx, 'LUNA / 07', x + w / 2, y + 29, '#243e56', 6);
      rect(ctx, x + w - 10, y - 10, 2, 15, '#d6ddd6'); rect(ctx, x + w - 11, y - 11, 4, 3, '#a1dfd2');
    },
    barrier(ctx, log) {
      rect(ctx, 3, 3, log.width, log.height, '#637e90'); rect(ctx, 3, 3, log.width, 2, '#d2d6cf');
      for (let x = 6; x < log.width; x += 10) rect(ctx, x, 6, 4, 3, '#344e64');
      rect(ctx, 4, 9, log.width - 2, 1, '#92a9b6');
    },
    guardian(ctx) {
      rect(ctx, 11, 33, 7, 10, '#90a5b1'); rect(ctx, 23, 33, 7, 10, '#90a5b1');
      rect(ctx, 10, 40, 9, 3, '#344e63'); rect(ctx, 22, 40, 9, 3, '#344e63');
      rect(ctx, 10, 19, 21, 18, '#aebfc5'); rect(ctx, 12, 20, 17, 12, '#d0d6d1');
      rect(ctx, 6, 21, 5, 13, '#92a8b3'); rect(ctx, 31, 21, 5, 13, '#92a8b3');
      rect(ctx, 17, 22, 10, 9, '#59798e'); rect(ctx, 19, 23, 6, 3, '#9bcfce');
      pixelOval(ctx, 9, 1, 23, 21, '#738da1'); pixelOval(ctx, 11, 2, 19, 18, '#d5dcd6');
      pixelOval(ctx, 13, 6, 15, 10, '#263f57'); rect(ctx, 15, 7, 9, 2, '#84bec9'); rect(ctx, 15, 10, 3, 2, '#adcccd');
      rect(ctx, 12, 33, 17, 3, '#697f91'); rect(ctx, 26, 26, 2, 3, '#a5d8c9');
    },
    gate(ctx, active) {
      rect(ctx, 9, 43, 46, 9, '#506b80'); rect(ctx, 12, 43, 40, 3, '#c0c9c8');
      pixelPolygon(ctx, [[11,44],[11,14],[18,7],[46,7],[53,14],[53,44]], '#3d586e');
      pixelPolygon(ctx, [[15,43],[15,16],[21,11],[43,11],[49,16],[49,43]], '#b9c6c9');
      rect(ctx, 20, 16, 24, 28, active ? '#314f65' : '#6f879b');
      if (active) { rect(ctx, 23, 18, 18, 24, '#8ecbcb33'); rect(ctx, 24, 20, 3, 19, '#b2e1d855'); }
      else { rect(ctx, 31, 16, 2, 28, '#374f65'); rect(ctx, 28, 27, 8, 7, '#3e596e'); rect(ctx, 30, 29, 4, 3, '#9ac9c8'); }
      for (const x of [16, 46]) rect(ctx, x, 20, 2, 18, active ? '#9cdecd' : '#789aac');
      text(ctx, active ? 'AIRLOCK OPEN' : 'AIRLOCK', 32, 65, '#d1dbd4', 6);
    },
  });
}
