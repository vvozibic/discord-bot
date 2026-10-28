import { WORLD, SPAWN, POND, BRIDGE, PATHS, HUT, TREES, LOGS, ROCKS } from './world.js';
import { rect, hash, texture } from './pixel-utils.js';

const onLane = (x, y, margin = 0) => PATHS.some(([px, py, w, h]) =>
  x >= px - margin && x < px + w + margin && y >= py - margin && y < py + h + margin);

function floor(ctx) {
  rect(ctx, 0, 0, WORLD.width, WORLD.height, '#263541');
  for (let y = 0; y < WORLD.height; y += 32) for (let x = 0; x < WORLD.width; x += 32) {
    const seed = hash(x, y);
    rect(ctx, x + 1, y + 1, 31, 31, seed > .66 ? '#3e515f' : seed < .3 ? '#344653' : '#394b59');
    rect(ctx, x + 2, y + 2, 29, 1, '#526875');
    rect(ctx, x + 2, y + 3, 1, 27, '#435966');
    if (seed > .75) { rect(ctx, x + 8, y + 17, 9, 1, '#785e4a'); rect(ctx, x + 15, y + 18, 5, 2, '#615044'); }
    if (seed < .16) { rect(ctx, x + 12, y + 5, 1, 9, '#283b48'); rect(ctx, x + 13, y + 12, 4, 1, '#283b48'); }
    if (seed > .42 && seed < .61) {
      rect(ctx, x + 8, y + 12, 14, 1, '#60748145'); rect(ctx, x + 12, y + 14, 10, 1, '#60748130');
    }
    rect(ctx, x + 4, y + 4, 1, 1, '#6c7e87'); rect(ctx, x + 27, y + 27, 1, 1, '#6c7e87');
  }
  for (const [x, y, w, h] of PATHS) {
    rect(ctx, x - 1, y - 1, w + 2, h + 2, '#839197'); rect(ctx, x, y, w, h, '#586b77');
    rect(ctx, x, y, w, 1, '#a3b0b1'); rect(ctx, x, y + h - 1, w, 1, '#394c59');
    if (w > h) for (let px = x + 5; px < x + w - 7; px += 20) {
      rect(ctx, px, y + 3, 10, 2, '#c9a15c'); rect(ctx, px, y + h - 5, 10, 2, '#b88c4e');
    }
    else for (let py = y + 5; py < y + h - 7; py += 20) {
      rect(ctx, x + 3, py, 2, 10, '#c9a15c'); rect(ctx, x + w - 5, py, 2, 10, '#b88c4e');
    }
  }
  // Cable runs and perimeter fencing are baked into the floor, outside the playable lanes.
  for (const x of [36, 40, 44]) { rect(ctx, x, 56, 2, 400, '#1f2a35'); rect(ctx, x, 56, 1, 400, '#8a6043'); }
  for (const x of [16, 750]) {
    rect(ctx, x, 24, 2, 464, '#182632'); rect(ctx, x + 2, 24, 1, 464, '#7d8991');
    for (let y = 28; y < 488; y += 16) rect(ctx, x - 3, y, 8, 2, '#92918a');
  }
  for (const y of [24, 494]) { rect(ctx, 16, y, 736, 2, '#192733'); rect(ctx, 16, y - 1, 736, 1, '#7a858d'); }
  rect(ctx, SPAWN.x - 13, SPAWN.y - 13, 26, 26, '#344e56');
  for (const dx of [-14, 12]) { rect(ctx, SPAWN.x + dx, SPAWN.y - 14, 2, 8, '#8fc8bd'); rect(ctx, SPAWN.x + dx, SPAWN.y + 7, 2, 8, '#8fc8bd'); }
  ctx.font = '8px monospace'; ctx.fillStyle = '#a0a2a1'; ctx.fillText('LOADING BAY', 72, 460);
  ctx.fillStyle = '#bd9a65'; ctx.fillText('SECTOR 02', 576, 454);
}

function serviceWear(ctx) {
  // Static floor wear and soft cast shadows; no extra scene objects or glow passes.
  for (const { x, y } of TREES) {
    rect(ctx, x - 9, y + 10, 37, 7, '#0d223027');
    rect(ctx, x + 1, y + 17, 29, 3, '#0d223017');
    const seed = hash(x + 19, y + 23);
    if (seed > .48 && !onLane(x + 12, y + 15, 5)) {
      rect(ctx, x + 8, y + 15, 9, 2, '#7d604a');
      rect(ctx, x + 12, y + 17, 7, 1, '#6c5949');
      rect(ctx, x + 6, y + 16, 3, 1, '#947451');
    }
  }
  rect(ctx, HUT.x + 8, HUT.y + HUT.height, HUT.width + 4, 6, '#0c243038');
  rect(ctx, HUT.x + 16, HUT.y + HUT.height + 6, HUT.width - 7, 4, '#0c24301a');
  // A cool reflection around the tank stays subdued and distinct from live hazards.
  rect(ctx, POND.x + 13, POND.y + POND.height + 11, POND.width - 26, 2, '#8dbcc51a');
  rect(ctx, POND.x + 22, POND.y + POND.height + 13, POND.width - 44, 2, '#8dbcc50c');
}

function coolant(ctx) {
  const { x, y, width:w, height:h } = POND;
  rect(ctx, x - 10, y - 9, w + 20, h + 20, '#1e2835');
  rect(ctx, x - 7, y - 6, w + 14, h + 14, '#75838a');
  rect(ctx, x - 4, y - 3, w + 8, h + 8, '#bda45f');
  for (let px = 0; px < w; px += 16) {
    rect(ctx, x + px, y - 5, 8, 4, '#252f38'); rect(ctx, x + px, y + h + 1, 8, 4, '#252f38');
  }
  for (let py = 0; py < h; py += 16) {
    rect(ctx, x - 6, y + py, 4, 8, '#252f38'); rect(ctx, x + w + 2, y + py, 4, 8, '#252f38');
  }
  rect(ctx, x, y, w, h, '#163748'); rect(ctx, x + 3, y + 3, w - 6, h - 6, '#205468');
  rect(ctx, x + 6, y + 5, w - 12, 2, '#65bac4');
  for (let py = y + 16; py < y + h - 8; py += 16) for (let px = x + 12; px < x + w - 8; px += 24) {
    const seed = hash(px, py);
    rect(ctx, px + Math.floor(seed * 6), py, 6 + Math.floor(seed * 6), 1, seed > .5 ? '#448c9c' : '#2d6c80');
    if (seed > .84) { rect(ctx, px + 8, py - 2, 2, 2, '#75c9c7'); rect(ctx, px + 9, py - 4, 1, 1, '#b7e9d5'); }
  }
  ctx.font = '8px monospace'; ctx.fillStyle = '#b2c8c6'; ctx.fillText('COOLANT / 04', x + 12, y - 13);
  const { x:bx, y:by, width:bw, height:bh } = BRIDGE;
  rect(ctx, bx - 4, by + 3, bw + 8, bh, '#152b36');
  rect(ctx, bx - 2, by, bw + 4, bh, '#828b92'); rect(ctx, bx + 2, by, bw - 4, bh, '#4a5b68');
  for (let py = by + 3; py < by + bh - 2; py += 6) {
    rect(ctx, bx + 5, py, bw - 10, 2, '#233b4b'); rect(ctx, bx + 6, py, bw - 12, 1, '#91a1a8');
    rect(ctx, bx + bw / 2, py, 2, 3, '#334552');
  }
  for (const px of [bx, bx + bw - 2]) {
    rect(ctx, px, by, 2, bh, '#d7b35f');
    for (let py = by; py < by + bh; py += 24) { rect(ctx, px - 2, py, 6, 8, '#273746'); rect(ctx, px - 1, py, 4, 2, '#f1d58a'); }
  }
}

function debris(ctx) {
  for (const [x, y] of ROCKS) {
    rect(ctx, x - 1, y + 7, 24, 5, '#25313c'); rect(ctx, x + 2, y + 2, 16, 8, '#72757a');
    rect(ctx, x + 4, y, 10, 4, '#9d9891'); rect(ctx, x + 5, y + 4, 8, 3, '#986e4d');
    rect(ctx, x + 11, y + 2, 7, 2, '#bf9768'); rect(ctx, x + 17, y + 8, 6, 2, '#8e9a9c');
    rect(ctx, x, y + 2, 3, 2, '#b5bfbb');
  }
}

function machine(ctx, variant) {
  const x = 26, y = 52;
  rect(ctx, x - 13, y + 8, 28, 8, '#10283748');
  rect(ctx, x - 7, y + 5, 14, 10, '#1c2a36'); rect(ctx, x - 6, y + 5, 12, 3, '#b09b72');
  if (variant === 0) {
    rect(ctx, x - 8, y - 40, 16, 45, '#273541'); rect(ctx, x - 6, y - 39, 12, 44, '#73818b');
    rect(ctx, x - 5, y - 38, 3, 42, '#a3a8a4'); rect(ctx, x + 3, y - 38, 3, 42, '#4c626e');
    for (const py of [y - 33, y - 11]) { rect(ctx, x - 11, py, 22, 5, '#2d414d'); rect(ctx, x - 10, py, 20, 2, '#d2b16b'); }
    rect(ctx, x - 17, y - 25, 10, 5, '#667884'); rect(ctx, x - 20, y - 27, 8, 8, '#283d49');
    rect(ctx, x - 18, y - 25, 4, 4, '#c4894f'); rect(ctx, x - 1, y - 25, 3, 8, '#a36d4d');
    rect(ctx, x - 7, y - 44, 14, 4, '#354854'); rect(ctx, x - 6, y - 44, 12, 1, '#c8c1a5');
  } else if (variant === 1) {
    rect(ctx, x - 1, y - 43, 2, 15, '#727f87'); rect(ctx, x - 3, y - 44, 6, 4, '#d5985a');
    rect(ctx, x - 13, y - 28, 26, 32, '#263642'); rect(ctx, x - 11, y - 27, 22, 30, '#8d6e54');
    rect(ctx, x - 10, y - 26, 20, 3, '#c69a63'); rect(ctx, x - 8, y - 20, 16, 12, '#263b4a');
    rect(ctx, x - 6, y - 18, 10, 2, '#8de2db'); rect(ctx, x - 6, y - 14, 6, 1, '#53a9b4');
    for (let px = x - 7; px < x + 8; px += 4) rect(ctx, px, y - 4, 2, 5, '#4e4f4c');
    rect(ctx, x + 9, y - 18, 2, 12, '#6a5546');
  } else {
    rect(ctx, x - 11, y - 39, 22, 43, '#2c3d49'); rect(ctx, x - 9, y - 38, 18, 40, '#607884');
    for (let py = y - 33; py < y; py += 6) { rect(ctx, x - 8, py, 16, 2, '#263e4d'); rect(ctx, x - 8, py - 1, 16, 1, '#8b9a9d'); }
    rect(ctx, x - 15, y - 43, 30, 5, '#293c48'); rect(ctx, x - 14, y - 43, 28, 2, '#b2a986');
    rect(ctx, x - 3, y - 42, 6, 2, '#79d2ce');
  }
}

function controlRoom(ctx) {
  const x = 12, y = 24, w = HUT.width, h = HUT.height;
  rect(ctx, x - 5, y + h - 2, w + 12, 8, '#0d263548');
  rect(ctx, x, y + 10, w, h - 10, '#2d3e4d'); rect(ctx, x + 4, y + 13, w - 8, h - 17, '#657785');
  for (let py = y + 19; py < y + h - 4; py += 12) rect(ctx, x + 5, py, w - 10, 1, '#405768');
  rect(ctx, x - 6, y + 3, w + 12, 12, '#334959'); rect(ctx, x - 7, y, w + 14, 5, '#a1a89c');
  rect(ctx, x - 5, y + 1, w + 10, 1, '#c5b99a');
  for (const px of [x + 12, x + w - 32]) {
    rect(ctx, px, y - 13, 20, 14, '#263b4a'); rect(ctx, px + 2, y - 12, 16, 10, '#7a8a91');
    for (let py = y - 10; py < y - 2; py += 3) rect(ctx, px + 4, py, 12, 1, '#3b5262');
  }
  rect(ctx, x + w / 2 - 5, y - 10, 10, 5, '#dd9c58');
  ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#e3d3ac'; ctx.fillText('CONTROL', x + w / 2, y + 28);
  for (const px of [x + 10, x + w - 30]) {
    rect(ctx, px - 2, y + 36, 24, 18, '#273c4b'); rect(ctx, px, y + 38, 20, 13, '#3b8996');
    rect(ctx, px + 2, y + 39, 5, 9, '#83d4d0'); rect(ctx, px + 9, y + 38, 2, 13, '#243e50');
    rect(ctx, px, y + 54, 20, 3, '#a99b7a');
  }
  rect(ctx, x + w / 2 - 12, y + 35, 24, h - 35, '#203745');
  rect(ctx, x + w / 2 - 9, y + 38, 18, h - 41, '#44717f');
  rect(ctx, x + w / 2 - 7, y + 40, 2, h - 45, '#8eccc5'); rect(ctx, x + w / 2 + 5, y + 54, 2, 5, '#f2d286');
  rect(ctx, x - 2, y + h - 5, w + 4, 5, '#273c4b');
  for (let px = x + 1; px < x + w; px += 12) rect(ctx, px, y + h - 4, 6, 2, '#c8a159');
}

function barrier(log) {
  return texture(log.width + 8, log.height + 10, ctx => {
    rect(ctx, 1, 10, log.width + 6, 7, '#10283748');
    rect(ctx, 3, 3, log.width, log.height, '#334450'); rect(ctx, 4, 3, log.width - 2, 3, '#8d999b');
    rect(ctx, 5, 8, log.width - 4, 5, '#d2ab5d');
    for (let x = 7; x < log.width; x += 12) rect(ctx, x, 8, 5, 5, '#343d43');
    rect(ctx, 2, 13, 5, 5, '#727e85'); rect(ctx, log.width - 2, 13, 5, 5, '#727e85');
  });
}

function foreman(ctx) {
  rect(ctx, 9, 42, 24, 4, '#20303c');
  rect(ctx, 14, 32, 5, 11, '#6f8790'); rect(ctx, 23, 32, 5, 11, '#536e7b');
  rect(ctx, 12, 41, 8, 3, '#d0b57c'); rect(ctx, 23, 41, 8, 3, '#d0b57c');
  rect(ctx, 11, 18, 20, 18, '#364c5b'); rect(ctx, 13, 20, 16, 14, '#c18b53');
  rect(ctx, 16, 23, 10, 7, '#2b4556'); rect(ctx, 18, 24, 6, 4, '#99e0d5');
  rect(ctx, 6, 20, 5, 13, '#8d9c9d'); rect(ctx, 31, 20, 5, 13, '#8d9c9d');
  rect(ctx, 11, 5, 20, 14, '#9cafad'); rect(ctx, 12, 4, 18, 4, '#dac18a');
  rect(ctx, 13, 10, 16, 6, '#233d4d'); rect(ctx, 15, 11, 4, 2, '#a7f0df'); rect(ctx, 23, 11, 4, 2, '#a7f0df');
  rect(ctx, 20, 0, 2, 5, '#627e8b'); rect(ctx, 19, 0, 4, 2, '#e2a362');
}

function portal(ctx, active) {
  rect(ctx, 7, 43, 50, 16, '#263c4a'); rect(ctx, 10, 43, 44, 8, '#8b9797');
  rect(ctx, 15, 45, 34, 3, active ? '#77e9d9' : '#b09c64');
  for (const x of [11, 45]) {
    rect(ctx, x, 6, 8, 40, '#203542'); rect(ctx, x + 1, 7, 6, 37, '#889a9e');
    rect(ctx, x + 3, 12, 2, 26, active ? '#a2f3e4' : '#66868c');
    rect(ctx, x - 2, 36, 12, 8, '#d2af67'); rect(ctx, x + 2, 37, 3, 7, '#334654');
  }
  rect(ctx, 13, 3, 38, 8, '#3b5261'); rect(ctx, 14, 3, 36, 2, '#b6bbab');
  rect(ctx, 24, 5, 16, 3, active ? '#8deadc' : '#c29e60');
  if (active) { rect(ctx, 22, 15, 20, 27, '#75d6cb22'); rect(ctx, 28, 13, 8, 30, '#a8fff022'); }
  ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#d6d8c2'; ctx.fillText(active ? 'GATE OPEN' : 'GATE', 32, 71);
}

export function createIndustrialArt() {
  const ground = texture(WORLD.width, WORLD.height, ctx => { floor(ctx); serviceWear(ctx); coolant(ctx); debris(ctx); });
  const machines = Array.from({ length:3 }, (_, index) => texture(52, 72, ctx => machine(ctx, index)));
  const room = texture(HUT.width + 24, HUT.height + 48, controlRoom);
  const scenery = [
    ...TREES.map(({ x, y }) => ({ x:x - 26, y:y - 52, depth:y + 12, asset:machines[Math.floor(hash(x, y) * 3)] })),
    { x:HUT.x - 12, y:HUT.y - 24, depth:HUT.y + HUT.height, asset:room },
    ...LOGS.map(log => ({ x:log.x - 3, y:log.y - 3, depth:log.y + log.height, asset:barrier(log) })),
  ].sort((a, b) => a.depth - b.depth);
  return { ground, scenery, guardianTexture:texture(40, 52, foreman), guardianAnchor:{ x:20, y:42 },
    portalTextures:[false,true].map(active => texture(64, 80, ctx => portal(ctx, active))) };
}
