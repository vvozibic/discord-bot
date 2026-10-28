import { WORLD, POND, BRIDGE, PATHS, HUT, TREES, LOGS, ROCKS, getCurrentLayoutId, getCurrentTheme } from './world.js';
import { rect, hash, texture } from './pixel-utils.js';
import { createIndustrialArt } from './industrial-art.js';

const onPath = (x, y, margin = 0) => PATHS.some(([px, py, w, h]) =>
  x >= px - margin && x < px + w + margin && y >= py - margin && y < py + h + margin);
const nearPond = (x, y, margin = 0) => x >= POND.x - margin && x < POND.x + POND.width + margin
  && y >= POND.y - margin && y < POND.y + POND.height + margin;
const insideHut = (x, y) => x >= HUT.x - 8 && x <= HUT.x + HUT.width + 8
  && y >= HUT.y - 20 && y <= HUT.y + HUT.height + 8;

// The light is painted into the map once: no lights, extra layers or frame work.
const sunClearings = [[176, 112, 100, 62], [388, 358, 132, 82], [632, 374, 90, 56]];
function sunlight(x, y) {
  let light = 0;
  for (const [cx, cy, rx, ry] of sunClearings) {
    light = Math.max(light, 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2);
  }
  return light;
}

// Integer scan lines keep every contour crisp at the game's native resolution.
function pixelOval(ctx, x, y, width, height, color) {
  const rx = width / 2, ry = height / 2;
  for (let row = 0; row < height; row++) {
    const offset = (row + .5 - ry) / ry;
    const span = Math.sqrt(Math.max(0, 1 - offset * offset)) * rx;
    rect(ctx, x + Math.ceil(rx - span), y + row, Math.max(1, Math.floor(span * 2)), 1, color);
  }
}

function grass(ctx, x, y, seed) {
  const shade = seed > .5 ? '#4c714c' : '#5a7c50';
  rect(ctx, x, y - 2, 1, 3, shade);
  rect(ctx, x - 2, y - 1, 1, 2, shade);
  rect(ctx, x + 2, y - 3, 1, 4, '#7b975f');
  if (seed > .7) rect(ctx, x + 3, y, 2, 1, '#91a96b');
}

function fern(ctx, x, y, seed) {
  const leaf = seed > .5 ? '#6d9259' : '#4f7b50';
  rect(ctx, x, y - 5, 1, 6, '#426d47');
  rect(ctx, x - 2, y - 4, 2, 1, leaf); rect(ctx, x + 1, y - 4, 2, 1, leaf);
  rect(ctx, x - 4, y - 2, 3, 1, leaf); rect(ctx, x + 2, y - 2, 3, 1, leaf);
  rect(ctx, x - 3, y - 1, 2, 1, '#85a365'); rect(ctx, x + 2, y - 1, 2, 1, '#78995e');
  rect(ctx, x - 5, y, 3, 1, leaf); rect(ctx, x + 3, y, 3, 1, leaf);
}

function paintMeadow(ctx) {
  rect(ctx, 0, 0, WORLD.width, WORLD.height, '#607e57');
  // Broad soft patches avoid a visible tile grid while leaving the trail legible.
  for (let y = 0; y < WORLD.height; y += 4) for (let x = 0; x < WORLD.width; x += 4) {
    const patch = hash(Math.floor(x / 44) * 44, Math.floor(y / 36) * 36);
    const shade = hash(x, y) * .45 + patch * .55;
    const light = sunlight(x, y) + hash(x + 31, y + 7) * .13;
    const color = light > .65 ? (shade > .5 ? '#86965e' : '#7f915c')
      : light > .26 ? (shade > .5 ? '#72895a' : '#6a8358')
      : shade < .25 ? '#597650' : shade > .76 ? '#66845a' : '#607e57';
    rect(ctx, x, y, 4, 4, color);
  }
  for (let y = 6; y < WORLD.height - 5; y += 9) for (let x = 5; x < WORLD.width - 5; x += 9) {
    const seed = hash(x + 11, y + 19);
    const gx = x + Math.floor(seed * 5), gy = y + Math.floor(hash(x, y) * 4);
    if (onPath(gx, gy, 5) || nearPond(gx, gy, 10) || insideHut(gx, gy)) continue;
    if (seed > .38) grass(ctx, gx, gy, seed);
    if (seed > .965) fern(ctx, gx, gy, seed);
    if (seed < .026) {
      rect(ctx, gx, gy, 1, 3, '#49734b');
      const petal = seed < .013 ? '#d5c987' : '#b8a7bc';
      rect(ctx, gx - 1, gy - 1, 3, 1, petal); rect(ctx, gx, gy - 2, 1, 3, petal);
      rect(ctx, gx, gy - 1, 1, 1, '#f2dea2');
    }
  }
  // Leaf litter and low ferns visually connect the forest floor with tree roots.
  for (const { x, y } of TREES) {
    for (let i = 0; i < 8; i++) {
      const dx = Math.floor(hash(x + i * 7, y) * 36) - 18;
      const dy = Math.floor(hash(x, y + i * 11) * 15) + 9;
      if (!onPath(x + dx, y + dy, 1) && !nearPond(x + dx, y + dy, 3)) {
        rect(ctx, x + dx, y + dy, 2, 1, i % 3 ? '#78915b' : '#9b9b64');
      }
    }
    if (!onPath(x - 13, y + 17, 5) && !nearPond(x - 13, y + 17, 5)) fern(ctx, x - 13, y + 17, hash(x, y));
  }
}

function paintPaths(ctx) {
  // Draw the union of the trails, so crossroads never gain artificial seams.
  for (let y = 48; y < WORLD.height - 40; y += 2) for (let x = 32; x < WORLD.width - 32; x += 2) {
    if (onPath(x, y)) {
      const litEdge = !onPath(x - 2, y) || !onPath(x, y - 2);
      const shadedEdge = !onPath(x + 2, y) || !onPath(x, y + 2);
      const light = sunlight(x, y);
      rect(ctx, x, y, 2, 2, litEdge ? '#d3c293' : shadedEdge ? '#a3976d' : light > .35 ? '#ceba8c' : '#beac80');
    } else if (onPath(x, y, 3)) {
      rect(ctx, x, y, 2, 2, hash(x, y) > .3 ? '#8d9467' : '#738158');
    }
  }
  for (let y = 46; y < WORLD.height - 40; y += 5) for (let x = 32; x < WORLD.width - 32; x += 7) {
    if (!onPath(x, y) || nearPond(x, y, 4)) continue;
    const seed = hash(x + 8, y + 3);
    if (seed > .65) rect(ctx, x, y, 2 + Math.floor(seed * 2), 1, '#cebc89');
    else if (seed < .22) rect(ctx, x, y, 2, 1, '#9e9167');
    if (seed > .91 && onPath(x + 1, y + 2)) rect(ctx, x + 1, y + 2, 1, 1, '#d9c895');
  }
  for (let y = 42; y < WORLD.height - 40; y += 13) for (let x = 38; x < WORLD.width - 32; x += 11) {
    if (!onPath(x, y, 5) || onPath(x, y, 1) || nearPond(x, y, 12)) continue;
    if (hash(x, y) > .42) grass(ctx, x, y, hash(y, x));
  }
  // Tiny flat stones and worn soil stay quiet; they are never new obstacles.
  for (let y = 56; y < WORLD.height - 42; y += 21) for (let x = 43; x < WORLD.width - 40; x += 25) {
    const seed = hash(x + 37, y + 13);
    if (seed < .81 || nearPond(x, y, 12) || insideHut(x, y)) continue;
    if (onPath(x, y)) {
      rect(ctx, x, y, 3, 1, '#9e946f'); rect(ctx, x, y - 1, 2, 1, '#dfcda1');
    } else if (seed > .91) {
      rect(ctx, x, y, 3, 1, '#9c9b6b'); rect(ctx, x + 3, y + 1, 2, 1, '#7f895c');
    }
  }
}

function paintGroundDepth(ctx) {
  // Low-opacity cast shadows connect objects to the floor without hiding paths.
  for (const { x, y } of TREES) {
    pixelOval(ctx, x - 13, y + 9, 48, 13, '#173c3020');
    pixelOval(ctx, x + 1, y + 15, 36, 10, '#173c3012');
    for (const direction of [-1, 1]) {
      const rx = x + direction * 8, ry = y + 15;
      if (onPath(rx, ry, 2) || nearPond(rx, ry, 3)) continue;
      rect(ctx, rx - 2, ry, 5, 1, '#766b45');
      rect(ctx, rx + direction * 3, ry + 1, 3, 1, '#887c4e');
    }
  }
  rect(ctx, HUT.x + 7, HUT.y + HUT.height, HUT.width + 5, 5, '#193d3026');
  rect(ctx, HUT.x + 13, HUT.y + HUT.height + 5, HUT.width - 4, 3, '#193d3014');
}

function paintPond(ctx) {
  const { x, y, width: w, height: h } = POND;
  // Rectangular inner banks precisely match the two existing water colliders.
  rect(ctx, x - 9, y - 8, w + 18, h + 17, '#789261');
  rect(ctx, x - 6, y - 5, w + 12, h + 11, '#a6a373');
  rect(ctx, x - 3, y - 3, w + 6, h + 6, '#c5b58a');
  rect(ctx, x, y, w, h, '#35696d');
  rect(ctx, x + 3, y + 3, w - 6, h - 6, '#477f80');
  rect(ctx, x + 8, y + 8, w - 16, h - 16, '#50898a');
  rect(ctx, x + 14, y + 15, w - 29, h - 28, '#4b8587');
  rect(ctx, x + 5, y + 4, w - 10, 2, '#83aaa0');
  rect(ctx, x + 5, y + 6, 2, h - 12, '#79a59b');
  rect(ctx, x + 8, y + h - 8, w - 16, 2, '#63958d');
  // Stationary surface marks add depth without a water-animation render cost.
  for (let wy = y + 15; wy < y + h - 10; wy += 13) for (let wx = x + 13; wx < x + w - 12; wx += 23) {
    if (wx > BRIDGE.x - 9 && wx < BRIDGE.x + BRIDGE.width + 6) continue;
    const seed = hash(wx + 5, wy);
    const ox = Math.floor(seed * 6);
    rect(ctx, wx + ox, wy, 4 + Math.floor(seed * 6), 1, seed > .5 ? '#76a6a0' : '#5c9494');
    if (seed > .72) rect(ctx, wx + ox - 2, wy + 2, 4, 1, '#69a09c');
  }
  // Reflections are baked into the shaded upper bank, away from the bridge.
  for (const offset of [.08, .215, .65, .81, .92]) {
    const rx = Math.round(x + offset * w);
    if (rx > BRIDGE.x - 12 && rx < BRIDGE.x + BRIDGE.width + 8) continue;
    rect(ctx, rx, y + 8, 7, 10, '#437a76'); rect(ctx, rx - 3, y + 11, 13, 4, '#427875');
    rect(ctx, rx + 1, y + 21, 5, 2, '#467e7c');
  }
  for (const [fx, fy] of [[.11,.745],[.20,.82],[.835,.205],[.895,.275],[.725,.86]]) {
    const lx = Math.round(x + fx * w), ly = Math.round(y + fy * h);
    if (lx > BRIDGE.x - 12 && lx < BRIDGE.x + BRIDGE.width + 3) continue;
    pixelOval(ctx, lx - 1, ly + 2, 11, 4, '#3c7773');
    pixelOval(ctx, lx, ly, 9, 5, '#78965f'); rect(ctx, lx + 2, ly, 4, 1, '#a0b274');
    rect(ctx, lx + 4, ly + 2, 4, 1, '#508063');
  }
  for (let bx = x - 3; bx < x + w + 3; bx += 11) {
    if (bx >= BRIDGE.x - 10 && bx <= BRIDGE.x + BRIDGE.width + 6) continue;
    const seed = hash(bx, y);
    rect(ctx, bx, y - 3, 3, 1, seed > .5 ? '#ddd09b' : '#90946a');
    rect(ctx, bx + 2, y + h + 2, 3, 1, '#d4c394');
    if (seed > .42) {
      grass(ctx, bx, y - 6, seed);
      grass(ctx, bx + 4, y + h + 7, seed);
    }
  }
  // Reeds stay on the shoreline; none imply an extra collision obstacle.
  for (const [rx, ry] of [[x-5,y+23],[x-4,y+h*.52],[x-4,y+h-23],
    [x+w+2,y+24],[x+w+3,y+h*.58],[x+w+1,y+h-17],[x+20,y+h+6],[x+w-18,y+h+7]]) {
    rect(ctx, rx, ry - 7, 1, 10, '#4e714d'); rect(ctx, rx + 3, ry - 9, 1, 11, '#5d8051');
    rect(ctx, rx - 2, ry - 4, 1, 6, '#6d8e57'); rect(ctx, rx + 5, ry - 5, 1, 7, '#6d8e57');
    rect(ctx, rx, ry - 9, 1, 3, '#a48e5e'); rect(ctx, rx + 3, ry - 11, 1, 3, '#ac9865');
  }
  // Bridge artwork follows the same live geometry used by collision and pathfinding.
  const { x: bx, y: by, width: bw, height: bh } = BRIDGE;
  rect(ctx, bx - 4, by + 2, bw + 8, bh, '#345955');
  rect(ctx, bx - 2, by, bw + 4, bh, '#5b503b'); rect(ctx, bx, by, bw, bh, '#a18459');
  for (let py = by; py < by + bh; py += 8) {
    const seed = hash(bx + bw / 2, py);
    rect(ctx, bx, py, bw, 2, '#c4a575');
    rect(ctx, bx, py + 7, bw, 1, '#705f43');
    rect(ctx, bx + 3 + Math.floor(seed * 5), py + 3, 10, 1, '#b39665');
    rect(ctx, bx + 20 + Math.floor(seed * 4), py + 5, 7, 1, '#887146');
    rect(ctx, bx + 2, py + 3, 1, 1, '#665942'); rect(ctx, bx + bw - 3, py + 3, 1, 1, '#665942');
  }
  rect(ctx, bx - 3, by + 5, 2, bh - 16, '#8a754e'); rect(ctx, bx + bw + 1, by + 5, 2, bh - 16, '#8a754e');
  for (const px of [bx - 4, bx + bw]) for (const offset of [0, .1923, .423, .654, .923]) {
    const py = Math.round(by + offset * bh);
    rect(ctx, px, py, 4, 9, '#5d513b'); rect(ctx, px, py, 4, 2, '#dbc08b');
    rect(ctx, px + 1, py + 2, 1, 5, '#b18f5e');
  }
}

function paintRocks(ctx) {
  for (const [x, y] of ROCKS) {
    pixelOval(ctx, x - 1, y + 6, 23, 7, '#4c704b');
    rect(ctx, x + 2, y + 1, 15, 8, '#656f66'); rect(ctx, x + 5, y - 1, 9, 10, '#848b78');
    rect(ctx, x + 3, y + 1, 10, 2, '#b2b39a'); rect(ctx, x + 5, y, 8, 1, '#c4c2a5');
    rect(ctx, x + 4, y + 3, 9, 4, '#919783'); rect(ctx, x + 12, y + 3, 5, 5, '#6b796d');
    rect(ctx, x + 12, y + 3, 2, 1, '#a6aa92'); rect(ctx, x + 8, y + 3, 1, 3, '#6e7b6e');
    rect(ctx, x + 3, y + 7, 5, 2, '#6a8a55'); rect(ctx, x + 4, y + 7, 3, 1, '#89a064');
    rect(ctx, x + 19, y + 8, 3, 2, '#8d947a'); rect(ctx, x + 20, y + 8, 1, 1, '#bec09e');
    grass(ctx, x - 2, y + 8, hash(x, y));
  }
}

function paintTree(ctx, variant) {
  const x = 26, y = 52;
  const palettes = [
    ['#203e35', '#2c503e', '#406a47', '#5c8150', '#8aa365'],
    ['#203f39', '#2b5545', '#406f53', '#5c885f', '#8fa96e'],
    ['#283f31', '#37573e', '#4c6e45', '#6b8652', '#a0aa67'],
  ];
  const [deep, dark, mid, light, tip] = palettes[variant % 3];
  pixelOval(ctx, x - 21, y + 7, 43, 12, '#1c3b302b');
  pixelOval(ctx, x - 15, y + 8, 30, 8, '#16382d2b');
  rect(ctx, x - 4, y - 10, 8, 25, '#493f2e'); rect(ctx, x - 2, y - 9, 5, 22, '#795b39');
  rect(ctx, x - 1, y - 8, 2, 22, '#a17a48'); rect(ctx, x + 2, y + 1, 1, 12, '#624c34');
  rect(ctx, x - 7, y + 13, 5, 2, '#6e5839'); rect(ctx, x + 2, y + 13, 6, 2, '#5d4e35');
  rect(ctx, x - 8, y + 14, 3, 1, '#8c7547'); rect(ctx, x - 3, y + 10, 2, 4, '#7e8d4d');
  // Stepped overlapping lobes leave a readable trunk and an uneven silhouette.
  const shift = variant > 2 ? 1 : -1;
  rect(ctx, x - 19, y - 17, 38, 15, deep); rect(ctx, x - 22, y - 13, 44, 7, deep);
  rect(ctx, x - 17, y - 29, 34, 19, deep); rect(ctx, x - 11 + shift, y - 38, 24, 20, deep);
  rect(ctx, x - 6 + shift, y - 44, 13, 12, deep);
  rect(ctx, x - 18, y - 18, 33, 14, dark); rect(ctx, x - 20, y - 12, 36, 5, dark);
  rect(ctx, x - 16, y - 30, 29, 17, dark); rect(ctx, x - 10 + shift, y - 39, 20, 15, dark);
  rect(ctx, x - 5 + shift, y - 43, 10, 9, light);
  rect(ctx, x - 14, y - 27, 23, 12, mid); rect(ctx, x - 16, y - 17, 17, 9, mid);
  rect(ctx, x - 10 + shift, y - 36, 16, 13, mid); rect(ctx, x - 8 + shift, y - 39, 11, 11, light);
  rect(ctx, x - 14, y - 25, 14, 5, light); rect(ctx, x - 18, y - 13, 11, 4, light);
  rect(ctx, x - 4, y - 19, 12, 5, mid); rect(ctx, x + 10, y - 18, 8, 9, dark);
  rect(ctx, x + 13, y - 13, 6, 5, mid); rect(ctx, x - 7, y - 8, 15, 5, dark);
  rect(ctx, x - 4, y - 41, 5, 2, tip); rect(ctx, x - 9, y - 31, 5, 2, tip);
  rect(ctx, x - 13, y - 23, 5, 2, tip); rect(ctx, x - 17, y - 11, 4, 1, tip);
  rect(ctx, x - 3, y - 26, 4, 2, light); rect(ctx, x + 6, y - 16, 3, 1, light);
  rect(ctx, x + 5, y - 7, 3, 2, '#3a5038'); rect(ctx, x - 11, y - 5, 4, 2, deep);
  for (let i = 0; i < 11; i++) {
    const lx = x - 14 + Math.floor(hash(variant + i, 17) * 27);
    const ly = y - 31 + Math.floor(hash(i, variant + 23) * 23);
    rect(ctx, lx, ly, 2, 1, i % 3 ? mid : light);
  }
  if (variant > 2) {
    rect(ctx, x + 4, y - 3, 3, 2, '#8d8b54'); rect(ctx, x + 5, y - 2, 2, 1, '#b1a367');
    rect(ctx, x - 8, y - 29, 2, 2, '#759056');
  }
}

function paintHut(ctx) {
  // Local (12, 24) is the unchanged top-left of the hut collider.
  const x = 12, y = 24, w = HUT.width, h = HUT.height;
  pixelOval(ctx, x - 7, y + h - 6, w + 16, 14, '#16382d35');
  rect(ctx, x + 2, y + 22, w - 4, h - 22, '#9f8a61');
  rect(ctx, x + 5, y + 25, w - 10, h - 31, '#c0a87a');
  rect(ctx, x + 5, y + 29, w - 10, 2, '#dbc18d');
  rect(ctx, x + 5, y + 31, 4, 35, '#ac9167'); rect(ctx, x + w - 11, y + 31, 5, 35, '#987d59');
  for (let py = y + 34; py < y + h - 7; py += 7) {
    rect(ctx, x + 6, py, w - 12, 1, '#a88e64'); rect(ctx, x + 9, py + 1, w - 20, 1, '#cbb487');
  }
  rect(ctx, x + 2, y + h - 7, w - 4, 7, '#69735a');
  for (let sx = x + 4; sx < x + w - 3; sx += 11) {
    rect(ctx, sx, y + h - 6, 9, 3, '#8f9476'); rect(ctx, sx + 1, y + h - 6, 6, 1, '#b0ad87');
  }
  rect(ctx, x + 33, y + 40, 22, 34, '#5a4936'); rect(ctx, x + 36, y + 43, 16, 28, '#856443');
  rect(ctx, x + 38, y + 44, 1, 25, '#ad8653'); rect(ctx, x + 45, y + 44, 1, 25, '#654f37');
  rect(ctx, x + 36, y + 66, 16, 2, '#aa8556'); rect(ctx, x + 49, y + 56, 2, 3, '#efd18a');
  rect(ctx, x + 30, y + 35, 28, 5, '#72573e');
  rect(ctx, x + 33, y + 36, 22, 1, '#b69a65');
  for (const wx of [x + 11, x + 64]) {
    rect(ctx, wx - 2, y + 38, 17, 18, '#8d714d');
    rect(ctx, wx, y + 39, 13, 16, '#514f40'); rect(ctx, wx + 2, y + 41, 9, 11, '#6d9d9a');
    rect(ctx, wx + 3, y + 41, 3, 4, '#abd1bc'); rect(ctx, wx + 3, y + 46, 2, 5, '#86b4a7');
    rect(ctx, wx + 6, y + 40, 1, 13, '#d9c68e'); rect(ctx, wx + 1, y + 46, 11, 1, '#d9c68e');
    rect(ctx, wx - 2, y + 55, 17, 3, '#765c3f'); rect(ctx, wx - 2, y + 55, 17, 1, '#d1b985');
    rect(ctx, wx - 2, y + 59, 17, 4, '#886045'); rect(ctx, wx, y + 58, 13, 2, '#5d8150');
    for (let i = 0; i < 3; i++) {
      rect(ctx, wx + 1 + i * 4, y + 56, 2, 2, i === 1 ? '#ddbd7d' : '#b7a2ad');
    }
  }
  rect(ctx, x - 9, y + 18, w + 18, 12, '#503d32');
  rect(ctx, x - 6, y + 10, w + 12, 14, '#80523d');
  rect(ctx, x + 1, y + 1, w - 2, 15, '#a66e49');
  rect(ctx, x + 12, y - 8, w - 24, 13, '#ba8354');
  rect(ctx, x + 21, y - 11, w - 42, 4, '#d49c64');
  for (let row = 0; row < 5; row++) {
    const py = y - 5 + row * 6;
    const inset = row === 0 ? 13 : row === 1 ? 4 : -4;
    const left = x + inset, right = x + w - inset;
    rect(ctx, left, py + 4, right - left, 1, row > 2 ? '#744e3c' : '#8e5e41');
    for (let px = left + (row % 2 ? 0 : 5); px < right - 2; px += 11) {
      rect(ctx, px, py, Math.min(8, right - px), 1, '#d49a61');
      rect(ctx, px + 8, py + 1, 1, 3, '#8e6042');
    }
  }
  rect(ctx, x - 8, y + 27, w + 16, 2, '#b47e4e');
  rect(ctx, x - 5, y + 29, w + 10, 2, '#68503a');
  rect(ctx, x + 65, y - 17, 10, 16, '#7d7d68');
  rect(ctx, x + 65, y - 15, 3, 13, '#a9a285');
  rect(ctx, x + 63, y - 19, 14, 4, '#bdb092'); rect(ctx, x + 65, y - 19, 10, 1, '#dfcfaa');
  rect(ctx, x + 69, y - 11, 5, 1, '#676e5f'); rect(ctx, x + 65, y - 6, 5, 1, '#676e5f');
  // Moss and vines add age in a few blocks, preserving the warm roof silhouette.
  for (const [mx, my, mw] of [[4, 20, 11], [8, 17, 6], [70, 13, 9], [73, 19, 13]]) {
    rect(ctx, x + mx, y + my, mw, 2, '#6f8150'); rect(ctx, x + mx + 2, y + my, mw - 3, 1, '#98a565');
  }
  rect(ctx, x + 4, y + 31, 2, 17, '#58774b'); rect(ctx, x + 2, y + 34, 5, 2, '#7e9457');
  rect(ctx, x + 3, y + 41, 5, 2, '#789052');
  rect(ctx, x + 30, y + h, 28, 4, '#b0a583'); rect(ctx, x + 28, y + h + 4, 32, 4, '#8b9070');
  rect(ctx, x + 31, y + h, 26, 1, '#d0c29a');
  // A little brass lantern reads at phone size and stays within the hut's bounds.
  rect(ctx, x + 58, y + 39, 1, 8, '#544c36'); rect(ctx, x + 56, y + 43, 5, 8, '#69563b');
  rect(ctx, x + 57, y + 45, 3, 4, '#edcb7b'); rect(ctx, x + 58, y + 45, 1, 3, '#f7e5ab');
}

function logAsset(log) {
  return texture(log.width + 8, log.height + 10, ctx => {
    pixelOval(ctx, 0, 7, log.width + 8, log.height + 1, '#193b3033');
    rect(ctx, 3, 4, log.width, log.height, '#594b33');
    rect(ctx, 3, 3, log.width - 2, 9, '#84633e'); rect(ctx, 5, 3, log.width - 5, 3, '#b18e58');
    rect(ctx, 7, 4, log.width - 13, 1, '#c2a26a'); rect(ctx, 5, 9, log.width - 5, 2, '#654f34');
    rect(ctx, 12, 6, 10, 1, '#9c7b4b'); rect(ctx, 19, 8, 7, 1, '#5d4c32');
    rect(ctx, 3, 5, 5, 8, '#c2a16a'); rect(ctx, 4, 6, 3, 6, '#957443');
    rect(ctx, 4, 7, 1, 3, '#d8bb7c');
    rect(ctx, log.width, 5, 4, 8, '#c7a672'); rect(ctx, log.width + 1, 7, 2, 4, '#8b6c44');
    rect(ctx, 11, 2, 7, 2, '#6b854d'); rect(ctx, 12, 2, 4, 1, '#9ba368');
    rect(ctx, log.width - 11, 3, 5, 2, '#798a4f');
  });
}

const artCache = new Map();
let sharedTrees, sharedHut;
export function createSceneryArt() {
  const layoutId = getCurrentLayoutId();
  if (artCache.has(layoutId)) return artCache.get(layoutId);
  if (getCurrentTheme() === 'industrial') {
    const art = createIndustrialArt(); artCache.set(layoutId, art); return art;
  }
  const ground = texture(WORLD.width, WORLD.height, ctx => {
    paintMeadow(ctx); paintPaths(ctx); paintGroundDepth(ctx); paintPond(ctx); paintRocks(ctx);
  });
  // All layouts share six tree textures and one hut; only the map ground is baked per layout.
  const trees = sharedTrees ??= Array.from({ length: 6 }, (_, variant) => texture(52, 72, ctx => paintTree(ctx, variant)));
  const hut = sharedHut ??= texture(112, 112, paintHut);
  const scenery = [
    ...TREES.map(({ x, y }) => ({
      x: x - 26, y: y - 52, depth: y + 12,
      asset: trees[Math.floor(hash(x + 9, y + 13) * trees.length)],
    })),
    { x: HUT.x - 12, y: HUT.y - 24, depth: HUT.y + HUT.height, asset: hut },
    ...LOGS.map(log => ({ x: log.x - 3, y: log.y - 3, depth: log.y + log.height, asset: logAsset(log) })),
  ].sort((a, b) => a.depth - b.depth);
  const art = { ground, scenery };
  artCache.set(layoutId, art);
  return art;
}
