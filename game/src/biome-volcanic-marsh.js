import { rect, hash, texture } from './pixel-utils.js';
import { buildBiomeScene, pixelPolygon, pixelOval, pixelLine } from './biome-paint.js';

const basinsFor = world => world.BASINS?.length ? world.BASINS : [{ ...world.POND, bridge:world.BRIDGE }];
const onLane = (world, x, y, margin = 0) => world.PATHS.some(([px, py, width, height]) =>
  x >= px - margin && x <= px + width + margin && y >= py - margin && y <= py + height + margin);

function basaltPlate(ctx, x, y, size, seed) {
  const cut = 3 + Math.floor(seed * 5);
  pixelPolygon(ctx, [[x + cut,y + 1],[x + size - 3,y],[x + size,y + size - cut],
    [x + size - cut,y + size],[x,y + size - 3],[x + 1,y + cut]], seed > .5 ? '#383440' : '#302d38');
  pixelLine(ctx, x + cut, y + 2, x + size - 4, y + 1, '#49414a');
  pixelLine(ctx, x + 2, y + cut, x + 1, y + size - 5, '#403844');
  if (seed > .67) {
    pixelLine(ctx, x + 9, y + 9, x + 15, y + 14, '#57413e');
    pixelLine(ctx, x + 15, y + 14, x + 12, y + 23, '#493833');
    rect(ctx, x + 14, y + 14, 2, 2, '#77503d');
  }
  if (seed < .22) rect(ctx, x + 8, y + 18, 7, 1, '#50434c');
  rect(ctx, x + size - 7, y + 5, 2, 1, '#61525a');
}

function moltenBasin(ctx, basin) {
  const { x, y, width, height } = basin;
  rect(ctx, x - 7, y - 7, width + 14, height + 14, '#1a1722');
  rect(ctx, x - 4, y - 4, width + 8, height + 8, '#5d3030');
  rect(ctx, x - 1, y - 1, width + 2, height + 2, '#a7432b');
  rect(ctx, x, y, width, height, '#d35429');
  for (let py = y + 3; py < y + height - 2; py += 5) for (let px = x + 3; px < x + width - 3; px += 12) {
    const seed = hash(px + 13, py);
    rect(ctx, px, py, Math.min(width + x - px - 2, 5 + Math.floor(seed * 7)), 2,
      seed > .65 ? '#ffd16a' : seed > .3 ? '#ed8638' : '#a83828');
    if (seed > .92) rect(ctx, px + 2, py - 1, 2, 2, '#ffed9d');
  }
  for (let py = y + 12; py < y + height - 12; py += 24) for (let px = x + 12; px < x + width - 12; px += 32) {
    if (hash(px, py) < .43) continue;
    pixelPolygon(ctx, [[px,py + 2],[px + 8,py],[px + 13,py + 5],[px + 9,py + 9],[px + 2,py + 7]], '#503039');
    rect(ctx, px + 3, py + 2, 6, 1, '#8d483b');
  }
  for (let px = x + 5; px < x + width - 4; px += 14) {
    rect(ctx, px, y - 4, 8, 2, '#73606a'); rect(ctx, px + 2, y + height + 2, 7, 2, '#352834');
  }
  const bridge = basin.bridge;
  if (!bridge) return;
  const { x:bx, y:by, width:bw, height:bh } = bridge;
  rect(ctx, bx - 2, by, bw + 4, bh, '#151622');
  rect(ctx, bx, by, bw, bh, '#625661');
  for (let py = by + 2; py < by + bh - 2; py += 12) {
    rect(ctx, bx + 3, py, bw - 6, 9, '#49434f');
    rect(ctx, bx + 4, py, bw - 8, 1, '#86737a');
    rect(ctx, bx + 6, py + 5, 4, 1, '#5b505e');
    rect(ctx, bx + bw - 8, py + 3, 2, 2, '#b48c65');
  }
  for (const px of [bx + 1,bx + bw - 3]) {
    rect(ctx, px, by, 2, bh, '#a7896d');
    for (let py = by + 4; py < by + bh; py += 24) rect(ctx, px - 1, py, 4, 4, '#403844');
  }
}

function volcanicGround(world, ctx) {
  rect(ctx, 0, 0, world.WORLD.width, world.WORLD.height, '#211f2a');
  const tile = texture(96, 96, tileCtx => {
    rect(tileCtx, 0, 0, 96, 96, '#211f2a');
    for (let y = 0; y < 96; y += 32) for (let x = 0; x < 96; x += 32) basaltPlate(tileCtx,x,y,31,hash(x + 23,y + 41));
  });
  for (let y = 0; y < world.WORLD.height; y += 96) for (let x = 0; x < world.WORLD.width; x += 96) ctx.drawImage(tile,x,y);
  for (let y = 11; y < world.WORLD.height; y += 13) for (let x = 7; x < world.WORLD.width; x += 17) {
    const seed = hash(x,y);
    if (seed > .84) rect(ctx,x,y,seed > .96 ? 3 : 1,1,seed > .96 ? '#74606a' : '#4a3c46');
  }
  for (const [x,y,width,height] of world.PATHS) {
    rect(ctx,x - 2,y - 2,width + 4,height + 4,'#181a24');
    rect(ctx,x,y,width,height,'#6a6065');
    for (let py = y + 2; py < y + height - 2; py += 8) for (let px = x + 2; px < x + width - 2; px += 16) {
      const seed = hash(px,py);
      rect(ctx,px,py,Math.min(14,x + width - px - 1),5,seed > .5 ? '#756a6e' : '#625a63');
      rect(ctx,px + 1,py,Math.min(11,x + width - px - 2),1,'#93828a');
    }
  }
  for (const basin of basinsFor(world)) moltenBasin(ctx,basin);
  for (const [x,y] of world.ROCKS) {
    pixelOval(ctx,x - 2,y + 7,24,8,'#181724');
    pixelPolygon(ctx,[[x,y + 8],[x + 4,y],[x + 14,y - 2],[x + 21,y + 7],[x + 14,y + 12],[x + 3,y + 11]],'#47404e');
    pixelPolygon(ctx,[[x + 4,y],[x + 14,y - 2],[x + 10,y + 7],[x + 1,y + 8]],'#71616c');
    pixelLine(ctx,x + 11,y + 2,x + 15,y + 8,'#302936');
  }
  pixelOval(ctx,world.SPAWN.x - 14,world.SPAWN.y - 8,28,16,'#8c7464');
  pixelOval(ctx,world.SPAWN.x - 10,world.SPAWN.y - 5,20,10,'#544b58');
}

function obsidianProp(ctx, variant) {
  pixelOval(ctx,8,61,38,9,'#14172388');
  rect(ctx,20,58,13,9,'#292833');
  if (variant === 0 || variant === 3) {
    pixelPolygon(ctx,[[14,60],[18,28],[25,10],[31,24],[33,57],[28,66]],'#252735');
    pixelPolygon(ctx,[[18,28],[25,10],[25,57],[20,62]],'#655466');
    pixelPolygon(ctx,[[25,10],[31,24],[33,57],[27,63]],'#383547');
    pixelLine(ctx,21,31,25,25,'#a57965'); rect(ctx,22,34,2,13,'#7a5c57');
    if (variant === 3) {
      pixelPolygon(ctx,[[7,60],[10,42],[15,31],[19,46],[19,64]],'#353241');
      pixelPolygon(ctx,[[33,64],[35,39],[41,27],[45,48],[42,64]],'#353241');
      pixelLine(ctx,36,44,40,36,'#79606b');
    }
  } else if (variant === 1) {
    for (const [x,y,h] of [[10,39,23],[20,18,46],[32,31,32]]) {
      pixelPolygon(ctx,[[x,y + 3],[x + 5,y],[x + 11,y + 3],[x + 10,y + h],[x + 4,y + h + 2],[x,y + h]],'#3c3543');
      rect(ctx,x + 1,y + 5,3,h - 5,'#665462'); rect(ctx,x + 8,y + 5,2,h - 5,'#282835');
      pixelLine(ctx,x + 1,y + 3,x + 6,y + 1,'#9c7b81');
    }
  } else {
    rect(ctx,17,26,20,35,'#40343e'); rect(ctx,19,28,15,30,'#65505a');
    pixelPolygon(ctx,[[13,29],[18,18],[35,18],[40,29]],'#332d3a');
    rect(ctx,18,18,17,3,'#8f746d'); rect(ctx,23,34,8,16,'#292734');
    rect(ctx,25,38,4,5,'#bc8c65'); rect(ctx,24,49,6,2,'#7f655b');
  }
  rect(ctx,17,65,21,2,'#5a464e'); rect(ctx,20,65,4,1,'#a17a68');
}

function forgeLandmark(world, ctx) {
  const { width:w,height:h } = world.HUT, x = 12, y = 24;
  rect(ctx,x - 3,y + h - 1,w + 6,6,'#161a2488');
  rect(ctx,x,y,w,h,'#352d3b'); rect(ctx,x + 3,y + 2,w - 6,h - 5,'#62505b');
  for (let py = y + 9; py < y + h - 2; py += 10) {
    rect(ctx,x + 3,py,w - 6,2,'#403440');
    for (let px = x + 11 + (py % 20 ? 8 : 0); px < x + w - 3; px += 20) rect(ctx,px,py - 8,1,8,'#473a46');
  }
  pixelPolygon(ctx,[[x - 7,y + 3],[x + 8,6],[x + w - 8,6],[x + w + 7,y + 3]],'#272733');
  pixelPolygon(ctx,[[x - 3,y + 1],[x + 10,10],[x + w - 10,10],[x + w + 2,y + 1]],'#50434d');
  rect(ctx,x + 8,6,w - 16,3,'#a78b7b'); rect(ctx,x - 5,y + 3,w + 10,4,'#927666');
  for (const px of [x + 5,x + w - 13]) {
    rect(ctx,px,y + 8,8,h - 12,'#352e3b'); rect(ctx,px + 1,y + 9,2,h - 15,'#9b7b78');
    rect(ctx,px - 2,y + h - 9,12,6,'#342d39');
  }
  const doorX = x + Math.floor(w / 2) - 12;
  pixelPolygon(ctx,[[doorX,y + h],[doorX,y + 39],[doorX + 6,y + 30],[doorX + 18,y + 30],
    [doorX + 24,y + 39],[doorX + 24,y + h]],'#252331');
  rect(ctx,doorX + 4,y + 43,16,h - 47,'#844a38');
  rect(ctx,doorX + 7,y + 47,10,h - 51,'#c27d46');
  for (const px of [x + 18,x + w - 30]) {
    rect(ctx,px,y + 18,13,16,'#2d2633'); rect(ctx,px + 3,y + 21,7,10,'#da9e58');
    rect(ctx,px + 6,y + 20,1,12,'#6c443d');
  }
  pixelPolygon(ctx,[[x + w / 2 - 6,12],[x + w / 2,7],[x + w / 2 + 6,12],[x + w / 2,18]],'#dbac6d');
}

function forgeGuardian(ctx) {
  pixelOval(ctx,8,40,26,7,'#15172488');
  rect(ctx,13,32,6,11,'#403847'); rect(ctx,23,32,6,11,'#403847');
  rect(ctx,11,40,9,4,'#958181'); rect(ctx,22,40,9,4,'#958181');
  pixelPolygon(ctx,[[11,20],[17,16],[26,16],[32,22],[29,36],[13,36]],'#64505a');
  rect(ctx,16,22,11,11,'#b47d54'); rect(ctx,18,24,7,7,'#453442');
  rect(ctx,8,20,5,14,'#918087'); rect(ctx,29,19,5,14,'#918087');
  rect(ctx,13,5,16,13,'#473748'); rect(ctx,11,9,20,6,'#827080');
  rect(ctx,15,10,12,4,'#222735'); rect(ctx,16,11,3,2,'#ffd78b'); rect(ctx,23,11,3,2,'#ffd78b');
  rect(ctx,7,27,3,17,'#6e5354'); rect(ctx,4,24,9,5,'#c59b79');
}

function volcanicGate(ctx, active) {
  pixelOval(ctx,8,43,48,17,'#191923');
  rect(ctx,12,43,40,8,'#72616d'); rect(ctx,16,44,32,2,'#a58a7b');
  for (const x of [12,44]) {
    pixelPolygon(ctx,[[x - 2,44],[x,16],[x + 5,6],[x + 10,15],[x + 10,44]],'#332d40');
    rect(ctx,x + 2,18,3,23,'#826878'); rect(ctx,x + 5,22,2,15,active ? '#f6c479' : '#655260');
  }
  pixelPolygon(ctx,[[14,15],[22,4],[42,4],[50,15],[40,12],[24,12]],'#5b4858');
  rect(ctx,24,5,16,3,'#ae8a76');
  pixelPolygon(ctx,[[27,7],[32,0],[37,7],[32,13]],active ? '#ffe8a4' : '#87685a');
  if (active) {
    pixelPolygon(ctx,[[24,41],[23,27],[27,18],[31,25],[35,15],[40,28],[39,41]],'#9b633c88');
    rect(ctx,29,24,7,17,'#eab66a66'); rect(ctx,31,28,3,12,'#ffe3a777');
  }
}

function marshBasin(ctx, basin) {
  const { x,y,width,height } = basin;
  rect(ctx,x - 6,y - 5,width + 12,height + 10,'#153a35');
  rect(ctx,x - 3,y - 2,width + 6,height + 5,'#355e4a');
  rect(ctx,x,y,width,height,'#092d30');
  for (let py = y + 5; py < y + height - 3; py += 9) for (let px = x + 4; px < x + width - 4; px += 15) {
    const seed = hash(px,py);
    rect(ctx,px,py,Math.min(x + width - px - 2,4 + Math.floor(seed * 7)),1,seed > .6 ? '#316655' : '#174540');
    if (seed > .92) { pixelOval(ctx,px,py + 2,8,4,'#3d6b4c'); rect(ctx,px + 3,py + 2,1,2,'#729473'); }
  }
  for (let px = x + 4; px < x + width - 2; px += 16) {
    const bridge = basin.bridge;
    if (bridge && px > bridge.x - 8 && px < bridge.x + bridge.width + 8) continue;
    rect(ctx,px,y - 7,1,8,'#83a47b'); rect(ctx,px + 3,y - 5,1,6,'#526e56');
    rect(ctx,px - 1,y - 9,3,4,'#ad9384');
    rect(ctx,px + 6,y + height - 1,1,7,'#73957a');
  }
  const bridge = basin.bridge;
  if (!bridge) return;
  const {x:bx,y:by,width:bw,height:bh} = bridge;
  rect(ctx,bx - 2,by,bw + 4,bh,'#193e39'); rect(ctx,bx,by,bw,bh,'#786f5c');
  for (let py = by + 1; py < by + bh - 1; py += 6) {
    rect(ctx,bx + 3,py,bw - 6,4,'#a08b6d'); rect(ctx,bx + 4,py,bw - 8,1,'#bcaa85');
    rect(ctx,bx + 9,py + 2,Math.max(2,bw - 19),1,'#746b58');
  }
  for (const px of [bx + 1,bx + bw - 3]) {
    rect(ctx,px,by,2,bh,'#464f3e');
    for (let py = by + 5; py < by + bh; py += 24) {
      rect(ctx,px - 1,py - 3,4,9,'#a08a68'); rect(ctx,px,py - 4,2,2,'#b9ceb0');
    }
  }
}

function marshGround(world, ctx) {
  const tile = texture(64,64,tileCtx => {
    rect(tileCtx,0,0,64,64,'#244b43');
    for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) {
      const seed = hash(x + 71,y + 33), patch = hash(Math.floor(x / 20),Math.floor(y / 20));
      rect(tileCtx,x,y,4,4,seed + patch > 1.25 ? '#3e5d46' : seed < .2 ? '#1e413e' : '#2d5043');
      if (seed > .75) rect(tileCtx,x + 1,y,2,1,'#68815c');
    }
  });
  for (let y = 0; y < world.WORLD.height; y += 64) for (let x = 0; x < world.WORLD.width; x += 64) ctx.drawImage(tile,x,y);
  for (let y = 13; y < world.WORLD.height; y += 17) for (let x = 9; x < world.WORLD.width; x += 19) {
    const seed = hash(x,y);
    if (onLane(world,x,y,6)) continue;
    if (seed > .82) {
      rect(ctx,x,y - 3,1,4,'#708c69'); rect(ctx,x - 2,y - 1,2,1,'#537a62');
      if (seed > .94) { rect(ctx,x - 1,y - 4,3,2,'#b68eb5'); rect(ctx,x,y - 5,1,1,'#d3afcb'); }
    }
    if (seed < .05) pixelOval(ctx,x,y,7,3,'#192f35');
  }
  for (const [x,y,width,height] of world.PATHS) {
    rect(ctx,x - 2,y - 2,width + 4,height + 4,'#183b35'); rect(ctx,x,y,width,height,'#5f7055');
    const horizontal = width >= height;
    if (horizontal) for (let px = x + 1; px < x + width - 2; px += 8) {
      rect(ctx,px,y + 2,6,height - 4,'#8a8664'); rect(ctx,px,y + 3,1,height - 6,'#afa078');
      if (hash(px,y) > .6) rect(ctx,px + 2,y + 6,2,Math.max(2,height - 13),'#6b7656');
    } else for (let py = y + 1; py < y + height - 2; py += 8) {
      rect(ctx,x + 2,py,width - 4,6,'#8a8664'); rect(ctx,x + 3,py,width - 6,1,'#afa078');
      if (hash(x,py) > .6) rect(ctx,x + 6,py + 2,Math.max(2,width - 13),2,'#6b7656');
    }
  }
  for (const basin of basinsFor(world)) marshBasin(ctx,basin);
  for (const [x,y] of world.ROCKS) {
    pixelOval(ctx,x - 2,y + 6,25,9,'#163530');
    pixelPolygon(ctx,[[x,y + 8],[x + 4,y],[x + 14,y - 1],[x + 21,y + 7],[x + 15,y + 11],[x + 3,y + 11]],'#526859');
    rect(ctx,x + 4,y + 1,11,3,'#849773'); rect(ctx,x + 7,y + 4,5,2,'#637f57');
    rect(ctx,x + 15,y + 1,1,5,'#a2b28b');
  }
  pixelOval(ctx,world.SPAWN.x - 13,world.SPAWN.y - 7,26,14,'#a1a082');
  pixelOval(ctx,world.SPAWN.x - 9,world.SPAWN.y - 4,18,8,'#526e5d');
}

function mushroomProp(ctx, variant) {
  pixelOval(ctx,6,61,41,9,'#112c3288');
  if (variant === 0 || variant === 3) {
    pixelPolygon(ctx,[[21,64],[24,35],[30,33],[32,63]],'#b9b9a0');
    rect(ctx,25,40,3,22,'#e2d7b5'); rect(ctx,29,43,2,19,'#6f8d80');
    pixelOval(ctx,6,20,42,22,variant === 0 ? '#675381' : '#4a7f78');
    pixelPolygon(ctx,[[7,31],[12,21],[23,14],[33,16],[43,25],[47,32]],variant === 0 ? '#9b78af' : '#74b6a1');
    rect(ctx,10,33,34,3,variant === 0 ? '#c5a1cb' : '#a9dbc2');
    for (const [x,y,w] of [[17,22,5],[28,18,4],[34,26,6],[12,28,3]]) {
      pixelOval(ctx,x,y,w,3,variant === 0 ? '#e4c5df' : '#dcf0cc');
    }
    for (let x = 14; x < 43; x += 6) pixelLine(ctx,x,36,26,41,'#54645c');
    if (variant === 3) {
      rect(ctx,9,51,3,12,'#99b9a1'); pixelOval(ctx,3,47,16,7,'#c69abf');
      rect(ctx,38,54,3,11,'#8aa68b'); pixelOval(ctx,32,49,17,8,'#b38bc0');
    }
  } else if (variant === 1) {
    for (const [x,y,h] of [[11,29,35],[23,16,49],[36,36,27]]) {
      rect(ctx,x,y + 5,4,h - 5,'#8ead9d'); rect(ctx,x + 1,y + 7,1,h - 7,'#d2ddbb');
      pixelOval(ctx,x - 7,y,18,10,'#4d8c82'); pixelOval(ctx,x - 6,y - 3,16,9,'#8acbb2');
      rect(ctx,x - 1,y - 2,3,2,'#def2ca'); rect(ctx,x - 5,y + 6,12,1,'#bddebf');
    }
  } else {
    pixelPolygon(ctx,[[16,65],[20,43],[17,32],[23,24],[29,35],[28,48],[33,65]],'#5d725e');
    pixelLine(ctx,22,36,24,61,'#9dac80',2);
    for (const [x,y,w,c] of [[8,28,28,'#88609b'],[19,19,24,'#b28ab6'],[20,40,28,'#709e91'],[5,47,22,'#9e7fae']]) {
      pixelOval(ctx,x,y,w,10,c); rect(ctx,x + 3,y + 7,w - 6,2,'#d1bea9');
      rect(ctx,x + 6,y + 2,3,2,'#dbd1c4');
    }
  }
  rect(ctx,18,65,18,2,'#4d7159'); rect(ctx,12,66,6,1,'#89a27b');
}

function myceliumLandmark(world, ctx) {
  const {width:w,height:h} = world.HUT, x = 12,y = 24;
  pixelOval(ctx,x - 3,y + h - 1,w + 7,7,'#102e3288');
  rect(ctx,x,y,w,h,'#475b48'); rect(ctx,x + 5,y + 4,w - 10,h - 17,'#7b8262');
  for (let px = x + 8; px < x + w - 4; px += 10) {
    rect(ctx,px,y + 3,2,h - 6,'#b5ad7c'); pixelLine(ctx,px + 2,y + 10,px + 5,y + h - 17,'#5e7456');
  }
  for (const px of [x + 3,x + w - 10]) {
    rect(ctx,px,y + h - 20,7,20,'#596b4a'); rect(ctx,px + 2,y + h - 16,2,14,'#a2a777');
  }
  pixelOval(ctx,x - 10,5,w + 20,31,'#5c5471');
  pixelPolygon(ctx,[[x - 9,25],[x + 2,12],[x + w / 2 - 10,2],[x + w / 2 + 12,3],
    [x + w - 1,13],[x + w + 9,25]],'#9c83a4');
  rect(ctx,x - 8,26,w + 16,4,'#c9b3be');
  for (let px = x - 2; px < x + w; px += 14) {
    pixelOval(ctx,px,18 + Math.floor(hash(px,4) * 4),8,4,'#d6c4cd');
    rect(ctx,px + 3,31,1,5,'#737b72');
  }
  const doorX = x + Math.floor(w / 2) - 10;
  rect(ctx,doorX,y + 29,21,h - 31,'#29483e'); rect(ctx,doorX + 3,y + 32,15,h - 35,'#476c54');
  rect(ctx,doorX + 5,y + 35,2,h - 40,'#91b18c'); rect(ctx,doorX + 15,y + 44,2,3,'#dbd4a8');
  for (const px of [x + 12,x + w - 29]) {
    pixelOval(ctx,px,y + 20,17,18,'#344d46'); pixelOval(ctx,px + 3,y + 23,11,12,'#8ac7ad');
    pixelLine(ctx,px + 8,y + 22,px + 8,y + 37,'#506e56');
  }
  rect(ctx,x + 13,y + h - 10,w - 26,4,'#b1a57a');
}

function marshGuardian(ctx) {
  pixelOval(ctx,7,40,27,7,'#12303288');
  rect(ctx,14,33,5,10,'#4b6f61'); rect(ctx,23,33,5,10,'#4b6f61');
  pixelPolygon(ctx,[[10,34],[13,20],[28,19],[32,35],[27,40],[15,40]],'#8a9d78');
  rect(ctx,15,17,12,11,'#bbcfaa'); rect(ctx,17,21,2,2,'#254a43'); rect(ctx,23,21,2,2,'#254a43');
  pixelOval(ctx,5,7,31,14,'#6c597c'); pixelPolygon(ctx,[[5,14],[13,3],[25,2],[35,14]],'#b095b6');
  rect(ctx,8,15,25,2,'#e1cbc9'); rect(ctx,15,7,4,3,'#e9d5d2'); rect(ctx,24,9,5,2,'#e1cbc9');
  rect(ctx,15,28,11,3,'#dad0aa'); rect(ctx,31,23,2,21,'#a79c74');
  pixelOval(ctx,27,19,10,6,'#8ec9b1'); rect(ctx,31,19,2,2,'#e2edc9');
}

function marshGate(ctx, active) {
  pixelOval(ctx,7,43,50,15,'#163932'); pixelOval(ctx,12,42,40,10,'#66846b');
  for (const x of [12,44]) {
    pixelPolygon(ctx,[[x - 2,47],[x,20],[x + 5,9],[x + 10,20],[x + 9,46]],'#53725b');
    pixelLine(ctx,x + 3,22,x + 3,44,'#a8bd8b',2);
    pixelOval(ctx,x - 6,16,20,8,'#9171a1'); rect(ctx,x - 3,20,14,2,'#d3b9cb');
  }
  pixelOval(ctx,14,3,38,16,'#725a88');
  pixelPolygon(ctx,[[13,12],[23,2],[39,1],[51,12]],'#ac8cb9');
  rect(ctx,17,13,30,3,'#d7c5d0'); rect(ctx,24,6,5,3,'#e8d7d6'); rect(ctx,37,7,4,2,'#e8d7d6');
  if (active) {
    pixelOval(ctx,22,19,20,28,'#85c9a944'); pixelOval(ctx,27,24,10,18,'#b7e9c766');
    for (const [x,y] of [[23,23],[38,28],[27,36],[36,17]]) rect(ctx,x,y,2,2,'#d4f3cb');
  }
  pixelOval(ctx,25,43,15,5,active ? '#c9eac1' : '#98a98a');
}

export function createVolcanicArt(world) {
  return buildBiomeScene(world, {
    ground:ctx => volcanicGround(world,ctx), prop:obsidianProp,
    landmark:ctx => forgeLandmark(world,ctx), guardian:forgeGuardian, gate:volcanicGate,
    barrier(ctx,log) {
      rect(ctx,3,3,log.width,log.height,'#342d3d'); rect(ctx,4,3,log.width - 2,3,'#8c7481');
      for (let x = 6; x < log.width; x += 10) {
        pixelPolygon(ctx,[[x,4],[x + 3,1],[x + 7,5],[x + 7,log.height + 3],[x,log.height + 3]],'#544350');
        rect(ctx,x + 1,4,2,log.height - 2,'#a38778');
      }
    },
  });
}

export function createMarshArt(world) {
  return buildBiomeScene(world, {
    ground:ctx => marshGround(world,ctx), prop:mushroomProp,
    landmark:ctx => myceliumLandmark(world,ctx), guardian:marshGuardian, gate:marshGate,
    barrier(ctx,log) {
      rect(ctx,3,3,log.width,log.height,'#596b4e'); rect(ctx,4,3,log.width - 2,3,'#a0a477');
      pixelLine(ctx,5,log.height + 1,log.width,5,'#324f3b',2);
      for (let x = 8; x < log.width; x += 14) {
        rect(ctx,x,4,2,log.height - 1,'#8e9770'); pixelOval(ctx,x - 3,0,10,5,'#ad8eb4');
      }
    },
  });
}
