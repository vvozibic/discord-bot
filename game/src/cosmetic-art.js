import { texture } from './pixel-utils.js';

const MOONLIGHT = new Map(Object.entries({
  '203b79':'433b79', '315eae':'7964b0', '6398e3':'b9a1ec', 'a2cbff':'e8daff',
  '28656d':'514870', '398e94':'8174a8', '6ac1ba':'bba7dc',
  '65858c':'727c9f', 'a8c3c5':'bdc7e8', 'e2eee5':'edf0ff',
}).map(([from,to]) => [parseInt(from,16), [0,2,4].map(offset => parseInt(to.slice(offset,offset+2),16))]));

/** Recolor a cached sprite once; no filters or pixel reads in the render loop. */
export function moonlightFrame(source) {
  return texture(source.width, source.height, ctx => {
    ctx.drawImage(source,0,0);
    const frame = ctx.getImageData(0,0,source.width,source.height), bytes = frame.data;
    for (let offset=0; offset<bytes.length; offset+=4) {
      const color = MOONLIGHT.get((bytes[offset]<<16) | (bytes[offset+1]<<8) | bytes[offset+2]);
      if (color && bytes[offset+3]) [bytes[offset],bytes[offset+1],bytes[offset+2]] = color;
    }
    ctx.putImageData(frame,0,0);
  });
}

/** Purely visual, bounded trail. It never enters a run trace or simulation state. */
export function createCosmeticTrail() {
  let points = [], delay = 0;
  return {
    clear() { points = []; delay = 0; },
    advance(dt, player, enabled) {
      if (!enabled) { points = []; delay = 0; return; }
      for (const point of points) point.age += dt;
      points = points.filter(point => point.age < .42);
      delay += dt;
      if (player?.walking && delay >= .06) {
        delay = 0; points.push({ x:player.x,y:player.y-2,age:0 });
        if (points.length > 8) points.shift();
      }
    },
    draw(ctx) {
      ctx.save();
      for (const point of points) {
        ctx.globalAlpha = (1-point.age/.42)*.7; ctx.fillStyle = '#f7df9a';
        ctx.fillRect(Math.round(point.x)-2,Math.round(point.y),4,1);
        ctx.fillRect(Math.round(point.x),Math.round(point.y)-2,1,4);
      }
      ctx.restore();
    },
  };
}
