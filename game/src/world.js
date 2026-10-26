export const TILE = 16;
export const PLAYER_SPEED = 144;
export const WORLD = { width: 768, height: 512 };
const borderTrees = [
  ...Array.from({ length: 15 }, (_, i) => ({ x: 48 + i * 48, y: 40 })),
  ...Array.from({ length: 15 }, (_, i) => ({ x: 48 + i * 48, y: 488 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 24, y: 88 + i * 48 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 744, y: 88 + i * 48 })),
];
const points = values => values.map(([x, y]) => ({ x, y }));
const definitions = {
  crossing: {
    name: 'Old Crossing',
    spawn: { x: 384, y: 352 }, portal: { x: 384, y: 416 },
    pond: { x: 464, y: 80, width: 224, height: 176 },
    bridge: { x: 544, y: 64, width: 32, height: 208 },
    hut: { x: 164, y: 184, width: 88, height: 74 }, guardian: { x: 296, y: 240 },
    paths: [[360,112,48,336],[128,336,544,32],[208,240,176,32],[544,64,32,296],[128,352,32,64]],
    rocks: [[324,216],[412,344],[184,372],[608,384],[336,448],[704,168]],
    trees: points([[96,112],[144,96],[224,104],[288,112],[352,72],[416,88],[432,192],
      [96,240],[112,320],[160,304],[256,304],[304,272],[432,280],[480,312],
      [624,296],[688,320],[672,400],[592,432],[512,416],[448,464],[288,448],
      [224,416],[112,432],[96,384]]),
    logs: [{ x: 448, y: 384, width: 48, height: 12 }, { x: 272, y: 176, width: 40, height: 12 }],
    collectibles: points([[336,320],[384,144],[560,144],[640,352],[224,272],[144,400]]),
  },
  waterside: {
    name: 'Lakeside Trail',
    spawn: { x: 608, y: 400 }, portal: { x: 608, y: 80 },
    pond: { x: 80, y: 184, width: 192, height: 144 },
    bridge: { x: 160, y: 168, width: 32, height: 176 },
    hut: { x: 480, y: 176, width: 88, height: 74 }, guardian: { x: 432, y: 264 },
    paths: [[584,64,48,368],[144,64,464,32],[144,80,32,352],[144,384,464,32],
      [256,320,352,32],[376,240,32,160],[392,240,112,32]],
    rocks: [[320,120],[688,224],[328,360],[520,432],[80,408],[432,88]],
    trees: points([[80,128],[224,112],[288,184],[336,208],[384,136],[432,176],
      [656,128],[688,176],[656,272],[688,336],[624,448],[560,304],[480,288],
      [464,368],[416,448],[336,432],[288,400],[240,368],[112,368],[96,440],
      [352,296],[288,72],[512,112],[544,80]]),
    logs: [{ x: 304, y: 264, width: 48, height: 12 }, { x: 648, y: 384, width: 40, height: 12 }],
    collectibles: points([[176,144],[176,272],[304,336],[608,224],[400,400],[656,400]]),
  },
  switchback: {
    name: 'Forked Woods',
    spawn: { x: 112, y: 400 }, portal: { x: 656, y: 112 },
    pond: { x: 304, y: 184, width: 208, height: 144 },
    bridge: { x: 384, y: 168, width: 32, height: 176 },
    hut: { x: 136, y: 80, width: 88, height: 74 }, guardian: { x: 256, y: 176 },
    paths: [[96,144,32,288],[112,384,544,32],[624,96,48,320],[384,96,272,32],
      [384,96,32,320],[112,144,288,32],[112,256,192,32],[496,256,160,32]],
    rocks: [[232,232],[560,176],[176,344],[448,416],[688,384],[320,80]],
    trees: points([[80,80],[272,104],[352,136],[448,72],[528,80],[592,152],
      [688,192],[560,240],[592,320],[688,304],[560,432],[496,368],[432,464],
      [320,448],[256,416],[224,336],[272,304],[176,224],[80,304],[160,448],
      [80,208],[704,448],[336,360],[464,144]]),
    logs: [{ x: 208, y: 352, width: 48, height: 12 }, { x: 528, y: 336, width: 40, height: 12 }],
    collectibles: points([[112,208],[272,160],[400,272],[656,336],[304,400],[560,112]]),
  },
  rustworks: {
    name: 'Rustworks', theme: 'industrial',
    spawn: { x:96, y:416 }, portal: { x:672, y:112 },
    pond: { x:320, y:144, width:256, height:192 },
    bridge: { x:432, y:128, width:48, height:224 },
    hut: { x:128, y:96, width:96, height:80 }, guardian: { x:256, y:176 },
    paths: [[80,64,40,384],[96,392,608,40],[648,80,48,352],[96,64,600,32],
      [264,96,40,320],[272,112,400,32],[432,336,48,80],[104,256,168,32]],
    rocks: [[176,344],[256,304],[616,224],[584,376],[360,392],[640,72]],
    trees: points([[80,128],[80,224],[160,240],[224,224],[240,80],[304,80],
      [368,96],[528,80],[608,112],[624,176],[688,224],[688,320],[624,352],
      [560,400],[496,432],[400,448],[320,432],[240,400],[176,448],[80,464],
      [304,368],[592,272]]),
    logs: [{ x:176, y:288, width:48, height:12 }, { x:536, y:352, width:48, height:12 }],
    collectibles: points([[152,200],[280,232],[456,208],[616,304],[360,368],[688,416]]),
  },
};

export const LAYOUTS = Object.freeze(Object.entries(definitions).map(([id, { name, theme = 'forest' }]) => Object.freeze({ id, name, theme })));
export let SPAWN, PORTAL, POND, BRIDGE, HUT, GUARDIAN, ROCKS, TREES, LOGS, COLLECTIBLES, PATHS;
let currentLayoutId, SOLIDS = [], walkability = null;
const siteCache = new Map();

export function getCurrentLayoutId() { return currentLayoutId; }
export function getCurrentTheme() { return definitions[currentLayoutId].theme ?? 'forest'; }

export function configureWorld(layoutId = 'crossing') {
  if (!Object.hasOwn(definitions, layoutId)) throw new RangeError(`Unknown forest layout: ${layoutId}`);
  const source = definitions[layoutId];
  currentLayoutId = layoutId;
  SPAWN = { ...source.spawn }; PORTAL = { ...source.portal };
  POND = { ...source.pond }; BRIDGE = { ...source.bridge };
  HUT = { ...source.hut }; GUARDIAN = { ...source.guardian };
  PATHS = source.paths.map(path => [...path]); ROCKS = source.rocks.map(rock => [...rock]);
  TREES = [...borderTrees, ...source.trees].map(tree => ({ ...tree }));
  LOGS = source.logs.map(log => ({ ...log })); COLLECTIBLES = source.collectibles.map(item => ({ ...item }));
  SOLIDS = [HUT, ...LOGS,
    { x: GUARDIAN.x - 5, y: GUARDIAN.y - 3, width: 10, height: 6 },
    ...ROCKS.map(([x, y]) => ({ x: x + 2, y: y + 4, width: 15, height: 6 })),
    { x: POND.x, y: POND.y, width: BRIDGE.x - POND.x, height: POND.height, water:true },
    { x: BRIDGE.x + BRIDGE.width, y: POND.y,
      width: POND.x + POND.width - BRIDGE.x - BRIDGE.width, height: POND.height, water:true },
    ...TREES.map(({ x, y }) => ({ x: x - 6, y: y + 6, width: 12, height: 9 })),
  ];
  walkability = null;
}

configureWorld();

export function canStand(x, y) {
  if (x < 29 || y < 27 || x > WORLD.width - 29 || y > WORLD.height - 27) return false;
  return !SOLIDS.some(r => x + 5 > r.x && x - 5 < r.x + r.width
    && y + 3 > r.y && y - 3 < r.y + r.height);
}

export function movePlayer(player, dx, dy, dt) {
  const length = Math.hypot(dx, dy);
  if (!length || dt <= 0) return false;
  const distance = PLAYER_SPEED * Math.min(dt, 0.05);
  const sx = dx / length * distance, sy = dy / length * distance;
  let moved = false;
  if (canStand(player.x + sx, player.y)) { player.x += sx; moved = Math.abs(sx) > 0.001; }
  if (canStand(player.x, player.y + sy)) { player.y += sy; moved ||= Math.abs(sy) > 0.001; }
  if (Math.abs(dx) > Math.abs(dy)) player.facing = dx > 0 ? 'right' : 'left';
  else player.facing = dy > 0 ? 'down' : 'up';
  return moved;
}

export function clearSegment(from, to) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x-from.x,to.y-from.y) / 3));
  for (let i=0;i<=steps;i++) {
    const fraction=i/steps;
    if (!canStand(from.x+(to.x-from.x)*fraction,from.y+(to.y-from.y)*fraction)) return false;
  }
  return true;
}

/** Airborne spells cross water but still collide with walls, trees and rocks. */
export function clearMagicSegment(from, to) {
  if (![from.x,from.y,to.x,to.y].every(Number.isFinite)) return false;
  const steps = Math.max(1,Math.ceil(Math.hypot(to.x - from.x,to.y - from.y) / 3));
  for (let index = 0; index <= steps; index++) {
    const amount = index / steps, x = from.x + (to.x - from.x) * amount, y = from.y + (to.y - from.y) * amount;
    if (x < 0 || y < 0 || x > WORLD.width || y > WORLD.height || SOLIDS.some(solid => !solid.water
      && x + 3 > solid.x && x - 3 < solid.x + solid.width && y + 3 > solid.y && y - 3 < solid.y + solid.height)) return false;
  }
  return true;
}

export function smoothPath(from, path) {
  const result=[];
  let current=from,index=0;
  while (index<path.length) {
    let next=path.length-1;
    while (next>index&&!clearSegment(current,path[next])) next--;
    if (!clearSegment(current,path[next])) return [];
    result.push(path[next]); current=path[next]; index=next+1;
  }
  return result;
}

export function followPath(player, path, dt) {
  let budget=PLAYER_SPEED*dt,moved=false;
  while (path.length&&budget>1e-6) {
    const next=path[0],dx=next.x-player.x,dy=next.y-player.y,distance=Math.hypot(dx,dy);
    if (distance<1e-6) { path.shift(); continue; }
    const travel=Math.min(distance,budget);
    const beforeX=player.x,beforeY=player.y;
    movePlayer(player,dx,dy,travel/PLAYER_SPEED);
    const actual=Math.hypot(player.x-beforeX,player.y-beforeY);
    moved ||= actual>1e-6;
    if (Math.hypot(next.x-player.x,next.y-player.y)<1e-5) path.shift();
    if (actual<travel-1e-5) { path.length=0; break; }
    budget-=travel;
  }
  return moved;
}

function walkableGrid() {
  if (walkability) return walkability;
  const cols = WORLD.width / TILE, rows = WORLD.height / TILE;
  walkability = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    walkability[y * cols + x] = canStand(x * TILE + TILE / 2, y * TILE + TILE / 2) ? 1 : 0;
  }
  return walkability;
}

export function findPath(from, to) {
  if (Math.hypot(to.x-from.x,to.y-from.y)<1) return [];
  if (clearSegment(from,to)) return [{x:to.x,y:to.y}];
  const cols = WORLD.width / TILE, rows = WORLD.height / TILE;
  const start = { x: Math.floor(from.x / TILE), y: Math.floor(from.y / TILE) };
  const goal = { x: Math.floor(to.x / TILE), y: Math.floor(to.y / TILE) };
  const id = (x, y) => y * cols + x;
  const center = (x, y) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
  if (goal.x < 0 || goal.y < 0 || goal.x >= cols || goal.y >= rows) return [];
  const end = center(goal.x, goal.y);
  if (!canStand(end.x, end.y)) return [];
  walkableGrid();
  const queue=[],previous=new Map();
  const starts=[];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const x=start.x+dx,y=start.y+dy;
    if(x<0||y<0||x>=cols||y>=rows||!walkability[id(x,y)])continue;
    const point=center(x,y);
    if(clearSegment(from,point))starts.push({x,y,distance:Math.hypot(point.x-from.x,point.y-from.y)});
  }
  starts.sort((a,b)=>a.distance-b.distance);
  for(const candidate of starts){queue.push(candidate);previous.set(id(candidate.x,candidate.y),null);}
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor];
    if (cell.x === goal.x && cell.y === goal.y) {
      const path = [];
      let current = id(cell.x, cell.y);
      while (current!==null) {
        path.unshift(center(current % cols, Math.floor(current / cols)));
        current = previous.get(current);
      }
      if (clearSegment(end,to)) path.push({x:to.x,y:to.y});
      return smoothPath(from,path);
    }
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x = cell.x + dx, y = cell.y + dy, key = id(x, y);
      if (x < 0 || y < 0 || x >= cols || y >= rows || previous.has(key)) continue;
      if (!walkability[key]||!clearSegment(center(cell.x,cell.y),center(x,y))) continue;
      previous.set(key, id(cell.x, cell.y)); queue.push({ x, y });
    }
  }
  return [];
}

function seededRandom(seed) {
  // FNV-1a + Mulberry32 makes numeric seeds and shared text codes stable across browsers.
  let state = 2166136261;
  for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function distanceToSegment(point, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
}

function expeditionSites() {
  if (siteCache.has(currentLayoutId)) return siteCache.get(currentLayoutId);
  const cols = WORLD.width / TILE, rows = WORLD.height / TILE, grid = walkableGrid();
  const id = (x, y) => y * cols + x;
  const center = (x, y) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
  const reachable = new Uint8Array(cols * rows), queue = [];
  const sx = Math.floor(SPAWN.x / TILE), sy = Math.floor(SPAWN.y / TILE);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = sx + dx, y = sy + dy;
    if (x < 0 || y < 0 || x >= cols || y >= rows || !grid[id(x, y)] || !clearSegment(SPAWN, center(x, y))) continue;
    reachable[id(x, y)] = 1; queue.push({ x, y });
  }
  // One flood per authored map, instead of a path search per random placement or retry loops.
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor];
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x = cell.x + dx, y = cell.y + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows || reachable[id(x, y)] || !grid[id(x, y)]) continue;
      if (!clearSegment(center(cell.x, cell.y), center(x, y))) continue;
      reachable[id(x, y)] = 1; queue.push({ x, y });
    }
  }
  const sites = [];
  for (let y = 72; y <= 440; y += 32) for (let x = 56; x <= 712; x += 32) {
    if (!reachable[id(Math.floor(x / TILE), Math.floor(y / TILE))]) continue;
    if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 35 || Math.hypot(x - PORTAL.x, y - PORTAL.y) < 35) continue;
    if (x > HUT.x - 28 && x < HUT.x + HUT.width + 28 && y > HUT.y - 24 && y < HUT.y + HUT.height + 40) continue;
    if (TREES.some(tree => Math.abs(x - tree.x) < 34 && y > tree.y - 48 && y < tree.y + 50)) continue;
    sites.push({ x, y });
  }
  const patrols = [];
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
    const from = sites[i], to = sites[j], distance = Math.hypot(from.x - to.x, from.y - to.y);
    if (distance < 64 || distance > 144 || (from.x !== to.x && from.y !== to.y)) continue;
    if (distanceToSegment(SPAWN, from, to) < 70 || distanceToSegment(PORTAL, from, to) < 50) continue;
    if (clearSegment(from, to)) patrols.push({ from, to });
  }
  const result = { sites, patrols };
  siteCache.set(currentLayoutId, result);
  return result;
}

export function createExpedition(seed = 'forest', { layoutId, hazardCount = 2 } = {}) {
  if (!Number.isInteger(hazardCount) || hazardCount < 0 || hazardCount > 4) throw new RangeError('Hazard count must be between 0 and 4');
  const random = seededRandom(seed);
  const selectedLayout = layoutId ?? LAYOUTS[Math.floor(random() * LAYOUTS.length)].id;
  configureWorld(selectedLayout);
  const { sites, patrols } = expeditionSites();
  const candidates = shuffle(sites, random), selected = [];
  const available = point => selected.every(other => Math.hypot(point.x - other.x, point.y - other.y) >= 40);
  // Distribute the main objective over six regions, leaving meaningful route-order choices.
  for (let region = 0; region < 6; region++) {
    const point = candidates.find(candidate => available(candidate)
      && Math.min(2, Math.floor(candidate.x / (WORLD.width / 3))) === region % 3
      && Math.floor(candidate.y / (WORLD.height / 2)) === Math.floor(region / 3));
    if (point) selected.push(point);
  }
  for (const point of candidates) {
    if (selected.length === 8) break;
    if (available(point)) selected.push(point);
  }
  if (selected.length !== 8) throw new Error(`Forest layout ${selectedLayout} needs more safe expedition sites`);
  const chosenPatrols = [];
  for (const patrol of shuffle(patrols, random)) {
    if (chosenPatrols.length === hazardCount) break;
    const midpoint = { x: (patrol.from.x + patrol.to.x) / 2, y: (patrol.from.y + patrol.to.y) / 2 };
    if (chosenPatrols.some(other => Math.hypot(midpoint.x - (other.from.x + other.to.x) / 2,
      midpoint.y - (other.from.y + other.to.y) / 2) < 110)) continue;
    chosenPatrols.push({ from: { ...patrol.from }, to: { ...patrol.to }, period: 6 + random() * 4, phase: random() * Math.PI * 2 });
  }
  if (chosenPatrols.length !== hazardCount) throw new Error(`Forest layout ${selectedLayout} needs ${hazardCount} clear patrols`);
  return {
    seed, layoutId: selectedLayout, layoutName: definitions[selectedLayout].name,
    items: selected.slice(0, 6).map(point => ({ ...point })),
    bonuses: selected.slice(6).map(point => ({ ...point })), hazards: chosenPatrols,
  };
}
