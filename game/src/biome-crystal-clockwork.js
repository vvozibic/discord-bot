import { rect, hash } from './pixel-utils.js';
import { buildBiomeScene, pixelPolygon as poly, pixelOval as oval, pixelLine as line } from './biome-paint.js';

function crystal(ctx, x, y, height, color, light) {
  poly(ctx, [[x,y],[x-8,y-9],[x-6,y-height+8],[x,y-height],[x+8,y-height+12],[x+7,y-5]], '#171a36');
  poly(ctx, [[x,y-3],[x-5,y-10],[x-4,y-height+9],[x,y-height+3]], light);
  poly(ctx, [[x,y-3],[x,y-height+3],[x+5,y-height+13],[x+4,y-7]], color);
  line(ctx,x,y-height+5,x,y-7,'#c2e8f6');
}

function gear(ctx, x, y, radius, color, center = '#332f2b') {
  for (let tooth = 0; tooth < 12; tooth++) {
    const phase = tooth * Math.PI / 6;
    rect(ctx,x+Math.round(Math.cos(phase)*radius)-2,y+Math.round(Math.sin(phase)*radius)-2,5,5,color);
  }
  oval(ctx,x-radius,y-radius,radius*2+1,radius*2+1,color);
  oval(ctx,x-radius+4,y-radius+4,radius*2-7,radius*2-7,center);
  for (let spoke = 0; spoke < 6; spoke++) {
    const phase = spoke*Math.PI/3;
    line(ctx,x,y,x+Math.cos(phase)*(radius-3),y+Math.sin(phase)*(radius-3),color,2);
  }
  oval(ctx,x-3,y-3,7,7,'#dfc68c');
  rect(ctx,x-1,y-1,3,3,center);
}

export function createCrystalArt(world) {
  const { WORLD, PATHS, BASINS, HUT, ROCKS } = world;
  return buildBiomeScene(world, {
    ground(ctx) {
      rect(ctx,0,0,WORLD.width,WORLD.height,'#201d3d');
      for(let y=0;y<512;y+=24)for(let x=0;x<768;x+=32){
        const n=hash(x+7,y+9);
        poly(ctx,[[x,y+4],[x+19,y],[x+32,y+11],[x+26,y+24],[x+5,y+20]],n>.5?'#30294e':'#282343');
        line(ctx,x+4,y+19,x+24,y+22,'#40345d');
        if(n>.78){rect(ctx,x+13,y+8,2,2,'#896abc');rect(ctx,x+15,y+6,1,1,'#c7a3dc');}
      }
      for(const [x,y,w,h] of PATHS){
        rect(ctx,x-2,y-2,w+4,h+4,'#181d36');rect(ctx,x,y,w,h,'#50416c');
        for(let py=y;py<y+h;py+=16)for(let px=x;px<x+w;px+=16){
          rect(ctx,px+1,py+1,14,1,'#76618a');rect(ctx,px+1,py+2,1,13,'#66517d');
          if(hash(px,py)>.75){line(ctx,px+5,py+5,px+10,py+10,'#b094cd');line(ctx,px+10,py+5,px+5,py+10,'#8b71b4');}
        }
      }
      for(const basin of BASINS){
        const {x,y,width:w,height:h,bridge:b}=basin;
        rect(ctx,x-5,y-5,w+10,h+10,'#706085');rect(ctx,x-2,y-2,w+4,h+4,'#17182f');rect(ctx,x,y,w,h,'#100f27');
        for(let py=y+8;py<y+h;py+=24)for(let px=x+8;px<x+w;px+=24){
          const n=hash(px,py);if(n>.42)crystal(ctx,px,py+12,10+Math.floor(n*16),'#4a386c','#725b97');
        }
        rect(ctx,b.x-2,b.y,b.width+4,b.height,'#251b3c');rect(ctx,b.x,b.y,b.width,b.height,'#755c97');
        for(let py=b.y+2;py<b.y+b.height;py+=16){
          rect(ctx,b.x+2,py,b.width-4,2,'#b59fc8');line(ctx,b.x+8,py+5,b.x+b.width-9,py+10,'#9a82bd');
          rect(ctx,b.x+2,py+5,2,5,'#69c7de');rect(ctx,b.x+b.width-4,py+5,2,5,'#69c7de');
        }
      }
      for(const [x,y] of ROCKS){poly(ctx,[[x,y+9],[x+2,y+3],[x+12,y],[x+21,y+8],[x+17,y+13]],'#58416c');line(ctx,x+3,y+4,x+12,y+1,'#9a78a9');crystal(ctx,x+12,y+10,13,'#8262bd','#b4a0df');}
      for(const x of [30,736])for(let y=38;y<480;y+=20)line(ctx,x,y,x+(x===30?7:-7),y+12,'#66507e',2);
    },
    prop(ctx,variant){
      oval(ctx,9,58,35,10,'#10162770');
      crystal(ctx,26,65,48-variant*4,'#6d50a4','#aa8bd8');
      crystal(ctx,16,65,25+variant*3,'#3c7e9e','#85d0e3');
      crystal(ctx,35,66,20+variant*4,'#73539c','#bcb1e5');
      rect(ctx,24,23+variant*4,3,2,'#f0ddff');rect(ctx,38,47,1,2,'#b9ffff');
    },
    landmark(ctx){
      const x=12,y=24,w=HUT.width,h=HUT.height;
      rect(ctx,x,y+16,w,h-16,'#393055');rect(ctx,x+3,y+19,w-6,h-23,'#5b4776');
      poly(ctx,[[x-5,y+20],[x+w/2,y-16],[x+w+5,y+20]],'#8b69b2');
      poly(ctx,[[x+3,y+17],[x+w/2,y-10],[x+w/2,y+17]],'#b9a3ce');
      for(const px of [x+8,x+w-17]){rect(ctx,px,y+24,9,h-25,'#937aab');rect(ctx,px+2,y+24,2,h-25,'#d2bce1');}
      rect(ctx,x+w/2-13,y+34,26,h-34,'#181c39');
      crystal(ctx,x+w/2,y+31,26,'#7a62b8','#c4d4f4');
      for(const px of [x+23,x+w-27]){rect(ctx,px,y+43,5,12,'#56abc1');rect(ctx,px+1,y+44,2,9,'#c6fbff');}
      rect(ctx,x+w/2-16,y+h-2,32,3,'#b8a5ca');
    },
    barrier(ctx,log){rect(ctx,3,3,log.width,log.height,'#463259');for(let x=7;x<log.width;x+=12){poly(ctx,[[x,3],[x+5,0],[x+9,3],[x+5,log.height+3]],'#aa83c5');}},
    guardian(ctx){
      oval(ctx,9,39,24,5,'#10182b88');poly(ctx,[[12,40],[15,20],[25,20],[29,40]],'#544577');
      rect(ctx,17,33,3,9,'#cab5d8');rect(ctx,23,33,3,9,'#baa0d0');rect(ctx,15,14,12,12,'#c6c3de');
      poly(ctx,[[12,17],[20,2],[29,17]],'#9779bf');rect(ctx,18,18,2,2,'#282447');rect(ctx,24,18,2,2,'#282447');
      rect(ctx,8,22,2,20,'#b494d1');crystal(ctx,9,21,11,'#7fc0e4','#c8f8ff');rect(ctx,17,26,9,2,'#9db7e2');
    },
    gate(ctx,active){
      oval(ctx,6,43,53,13,'#4a3d65');for(const x of [13,48]){rect(ctx,x,15,5,34,'#8d75ac');crystal(ctx,x+2,22,17,'#a48ad3','#e2cdff');}
      poly(ctx,[[17,17],[32,3],[49,17],[44,22],[32,12],[21,22]],'#a992c8');
      if(active){poly(ctx,[[23,41],[22,25],[32,16],[43,25],[42,41]],'#535f9c');crystal(ctx,32,39,18,'#8fc9ed','#dbffff');}
      rect(ctx,24,46,17,2,active?'#b8faff':'#6c5488');
    },
  });
}

export function createClockworkArt(world) {
  const { WORLD, PATHS, BASINS, HUT, ROCKS }=world;
  return buildBiomeScene(world,{
    ground(ctx){
      rect(ctx,0,0,WORLD.width,WORLD.height,'#302b2b');
      for(let y=0;y<512;y+=16)for(let x=0;x<768;x+=32){
        const n=hash(x,y);rect(ctx,x+1,y+1,30,14,n>.5?'#594536':'#4d3c31');
        rect(ctx,x+2,y+2,27,1,'#816044');rect(ctx,x+30,y+3,1,11,'#2e2a27');rect(ctx,x+5,y+10,18,1,'#6d5039');
        if(n>.85)rect(ctx,x+15,y+4,1,6,'#ae8554');
      }
      for(const [x,y,w,h] of PATHS){
        rect(ctx,x-2,y-2,w+4,h+4,'#201f22');rect(ctx,x,y,w,h,'#927044');rect(ctx,x+3,y+3,w-6,h-6,'#4c5149');
        for(let px=x+5;px<x+w-4;px+=16)rect(ctx,px,y+1,2,2,'#edd59a');
        for(let py=y+5;py<y+h-4;py+=16)rect(ctx,x+1,py,2,2,'#edd59a');
        if(w>h)for(let px=x+10;px<x+w-10;px+=40)line(ctx,px,y+h/2,px+14,y+h/2,'#b9aa74');
        else for(let py=y+10;py<y+h-10;py+=40)line(ctx,x+w/2,py,x+w/2,py+14,'#b9aa74');
      }
      for(const {x,y,width:w,height:h,bridge:b} of BASINS){
        rect(ctx,x-5,y-5,w+10,h+10,'#ac8552');rect(ctx,x-2,y-2,w+4,h+4,'#3b302b');rect(ctx,x,y,w,h,'#1c2227');
        for(let py=y+24;py<y+h-12;py+=40)for(let px=x+24;px<x+w-12;px+=40)gear(ctx,px,py,13,'#5a5845','#1c2729');
        rect(ctx,b.x-3,b.y,b.width+6,b.height,'#302a28');rect(ctx,b.x,b.y,b.width,b.height,'#b38a4c');
        rect(ctx,b.x+4,b.y,b.width-8,b.height,'#545d51');
        for(let py=b.y+4;py<b.y+b.height;py+=12){rect(ctx,b.x+5,py,b.width-10,2,'#a9a271');rect(ctx,b.x-2,py,3,4,'#e3c68b');rect(ctx,b.x+b.width-1,py,3,4,'#e3c68b');}
      }
      for(const [x,y] of ROCKS){rect(ctx,x+2,y+4,17,8,'#4c493c');gear(ctx,x+10,y+7,7,'#b39256');rect(ctx,x+15,y+2,4,6,'#789084');}
      for(const x of [30,736]){rect(ctx,x,30,3,450,'#b99355');for(let y=42;y<480;y+=24)rect(ctx,x-2,y,7,3,'#dcc590');}
      for(const y of [30,479]){rect(ctx,30,y,709,3,'#b99355');for(let x=44;x<736;x+=24)rect(ctx,x,y-2,3,7,'#dcc590');}
    },
    prop(ctx,variant){
      oval(ctx,9,58,35,10,'#14202177');rect(ctx,21,27,11,37,'#4e5c52');rect(ctx,19,61,15,5,'#b18c54');
      if(variant%2===0){gear(ctx,26,27,17,'#bc9558');gear(ctx,26,27,9,'#e1c285');line(ctx,26,27,26,17,'#f5e0ad',2);line(ctx,26,27,33,30,'#f5e0ad',2);}
      else {rect(ctx,17,8,19,43,'#9b7849');rect(ctx,19,10,15,39,'#303c3e');rect(ctx,23,13,2,27,'#dcc080');oval(ctx,21,37,11,10,'#ba9353');rect(ctx,18,7,17,3,'#e0c593');}
      rect(ctx,23,48,2,11,'#c5b584');rect(ctx,29,48,2,11,'#839587');
    },
    landmark(ctx){
      const x=12,y=24,w=HUT.width,h=HUT.height;
      rect(ctx,x,y+12,w,h-12,'#66503a');rect(ctx,x+3,y+15,w-6,h-18,'#967349');
      rect(ctx,x-4,y+8,w+8,7,'#c6a36a');rect(ctx,x+3,y+2,w-6,6,'#4d5d55');
      rect(ctx,x+20,y-11,w-40,14,'#a68450');rect(ctx,x+24,y-9,w-48,11,'#314349');
      gear(ctx,x+w/2,y+24,21,'#d1ae6e');oval(ctx,x+w/2-14,y+10,29,29,'#e6d4a4');
      for(let hour=0;hour<12;hour++){const a=hour*Math.PI/6;rect(ctx,x+w/2+Math.round(Math.sin(a)*11)-1,y+24-Math.round(Math.cos(a)*11)-1,2,2,'#5d503b');}
      line(ctx,x+w/2,y+24,x+w/2,y+15,'#584934',2);line(ctx,x+w/2,y+24,x+w/2+7,y+27,'#584934',2);
      rect(ctx,x+w/2-12,y+49,24,h-49,'#293c3c');rect(ctx,x+w/2-10,y+51,20,h-53,'#577468');
      for(const px of [x+9,x+w-17]){rect(ctx,px,y+30,8,h-31,'#c5a569');rect(ctx,px+2,y+32,2,h-34,'#edd4a0');}
    },
    barrier(ctx,log){rect(ctx,3,3,log.width,log.height,'#b28b50');rect(ctx,4,4,log.width-2,2,'#ebd49b');for(let x=6;x<log.width;x+=8)rect(ctx,x,6,3,Math.max(2,log.height-3),'#42635b');},
    guardian(ctx){
      oval(ctx,8,39,25,5,'#18262788');rect(ctx,13,25,15,13,'#77613e');rect(ctx,16,36,4,7,'#b3a077');rect(ctx,23,36,4,7,'#b3a077');
      rect(ctx,14,12,15,13,'#d1b480');rect(ctx,12,10,19,4,'#65553c');rect(ctx,16,4,12,7,'#a88c54');rect(ctx,16,6,11,2,'#d7c28b');
      rect(ctx,16,17,4,3,'#426f65');rect(ctx,23,17,4,3,'#426f65');line(ctx,19,18,24,18,'#f5dda0');gear(ctx,9,31,6,'#c8a563');rect(ctx,30,26,2,17,'#bba36d');
    },
    gate(ctx,active){
      rect(ctx,5,45,55,8,'#8e714b');for(const x of [11,48]){rect(ctx,x,12,6,34,'#c09b61');rect(ctx,x+1,14,2,30,'#e6ce98');}
      gear(ctx,32,16,18,'#b38b4f');oval(ctx,20,4,25,25,active?'#73c0a2':'#3f554e');gear(ctx,32,16,9,active?'#f0d591':'#8c7c58');
      for(let i=0;i<3;i++){rect(ctx,21+i*8,34,5,10,active?'#9ee5c7':'#647b68');rect(ctx,22+i*8,35,1,7,'#d7bf86');}
    },
  });
}
