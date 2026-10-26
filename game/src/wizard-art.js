import { rect } from './pixel-utils.js';

const COLORS = {
  outline:'#192d46', shade:'#203b79', blue:'#315eae', light:'#6398e3', shine:'#a2cbff',
  gold:'#edcc83', goldShade:'#a48150', skin:'#dfb38b', skinLight:'#f5d3a4',
  beard:'#eceddb', beardShade:'#a8bec7', wood:'#695047', woodLight:'#b88c62',
};
const p = (ctx,x,y,w,h,color) => rect(ctx,x,y,w,h,COLORS[color] ?? color);
export const WIZARD_CAST_POSES = [-.2,.05,.48,.6,.35,0];

function hat(ctx, back = false) {
  // A bent tip and stepped brim keep the silhouette readable at native size.
  p(ctx,17,1,5,1,'outline'); p(ctx,15,2,8,3,'outline'); p(ctx,13,5,9,3,'outline');
  p(ctx,11,8,13,4,'outline'); p(ctx,9,11,16,3,'outline');
  p(ctx,17,2,4,1,'light'); p(ctx,16,3,5,3,'blue'); p(ctx,14,6,6,3,'blue');
  p(ctx,12,9,10,4,'blue'); p(ctx,13,8,2,4,'light'); p(ctx,21,9,2,4,'shade');
  p(ctx,11,12,13,2,'shade'); p(ctx,12,12,10,1,'goldShade');
  p(ctx,6,14,22,2,'outline'); p(ctx,8,13,18,2,'outline');
  p(ctx,8,14,17,1,'light'); p(ctx,9,15,16,1,'blue');
  if (!back) { p(ctx,18,7,1,4,'gold'); p(ctx,17,8,3,1,'gold'); p(ctx,18,8,1,1,'shine'); }
}

function staff(ctx, swing = 0, cast = 0) {
  const y = Math.round(swing * .5);
  ctx.save(); ctx.translate(28,27); ctx.rotate(cast * .65); ctx.translate(-28,-27);
  p(ctx,28,17+y,2,19,'outline'); p(ctx,28,18+y,1,17,'woodLight');
  p(ctx,27,23+y,3,2,'goldShade'); p(ctx,28,24+y,2,1,'gold');
  p(ctx,25,12+y,6,6,'outline'); p(ctx,26,11+y,4,8,'outline');
  p(ctx,26,13+y,4,4,'#4f9fc7'); p(ctx,27,12+y,2,6,'#83e9f1');
  p(ctx,26,14+y,3,2,'#b7ffff'); p(ctx,27,13+y,1,2,'#f0ffff');
  p(ctx,26,18+y,4,1,'gold');
  ctx.restore();
}

function boots(ctx, pose, profile = false) {
  const left = (profile ? 13 : 10) + pose.left, right = (profile ? 19 : 19) + pose.right;
  p(ctx,left,32-pose.liftLeft,5,5,'outline'); p(ctx,left+1,33-pose.liftLeft,3,3,'wood');
  p(ctx,left,35-pose.liftLeft,5,1,'woodLight');
  p(ctx,right,32-pose.liftRight,5,5,'outline'); p(ctx,right+1,33-pose.liftRight,3,3,'wood');
  p(ctx,right,35-pose.liftRight,5,1,'woodLight');
}

function robe(ctx, pose, back = false) {
  const hem = Math.sign(pose.arm);
  p(ctx,10,21,14,8,'outline'); p(ctx,8,27,18,5,'outline'); p(ctx,7+hem,31,20,3,'outline');
  p(ctx,11,22,12,7,'blue'); p(ctx,9,28,16,4,'blue'); p(ctx,8+hem,31,18,2,'blue');
  p(ctx,11,24,3,7,'light'); p(ctx,10+hem,31,3,1,'light');
  p(ctx,21,23,2,7,'shade'); p(ctx,23,29,2,3,'shade'); p(ctx,16,28,2,4,'shade');
  p(ctx,8+hem,33,19,1,'goldShade'); p(ctx,10+hem,32,3,1,'gold'); p(ctx,22+hem,32,2,1,'gold');
  if (back) {
    p(ctx,15,23,4,1,'gold'); p(ctx,16,24,2,4,'goldShade'); p(ctx,14,26,6,1,'gold');
    p(ctx,16,25,2,2,'shine');
  } else {
    p(ctx,10,27,14,2,'wood'); p(ctx,16,27,3,2,'gold'); p(ctx,17,27,1,1,'shine');
  }
}

function front(ctx, pose, back) {
  boots(ctx,pose);
  ctx.save(); ctx.translate(0,pose.bob);
  staff(ctx,-pose.arm,pose.cast);
  p(ctx,6,21,5,8,'outline'); p(ctx,7,22,3,6,'blue'); p(ctx,7,22,1,4,'light');
  p(ctx,6,28+pose.arm,4,3,'outline'); p(ctx,7,28+pose.arm,2,2,'skinLight');
  robe(ctx,pose,back);
  p(ctx,23,22,4,7,'outline'); p(ctx,24,23,2,5,'blue'); p(ctx,25,27-pose.arm*.5,4,2,'skin');
  p(ctx,11,15,13,7,'outline');
  if (back) { p(ctx,12,16,11,5,'shade'); p(ctx,12,16,3,4,'blue'); }
  else {
    p(ctx,12,16,11,5,'skin'); p(ctx,13,16,8,1,'skinLight');
    p(ctx,13,17,2,1,'outline'); p(ctx,20,17,2,1,'outline');
    p(ctx,16,18,3,2,'skinLight');
    p(ctx,12,20,11,2,'beardShade'); p(ctx,13,20,9,2,'beard');
    p(ctx,14,22,7,2,'beard'); p(ctx,15,24,5,1,'beardShade'); p(ctx,16,24,3,2,'beard');
    p(ctx,16,20,3,1,'wood'); p(ctx,14,21,2,1,'#ffffff');
  }
  hat(ctx,back);
  ctx.restore();
}

function profile(ctx, pose) {
  boots(ctx,pose,true);
  ctx.save(); ctx.translate(0,pose.bob);
  p(ctx,12,21,12,9,'outline'); p(ctx,11,29,15,5,'outline');
  p(ctx,13,22,10,8,'blue'); p(ctx,12,30,13,3,'blue');
  p(ctx,13,23,2,8,'light'); p(ctx,22,24,2,8,'shade'); p(ctx,12,32,13,1,'goldShade');
  p(ctx,14,27,10,2,'wood'); p(ctx,22,27,2,2,'gold');
  p(ctx,13,15,12,7,'outline'); p(ctx,18,16,6,5,'skin'); p(ctx,24,18,2,2,'skinLight');
  p(ctx,21,17,2,1,'outline'); p(ctx,20,20,5,3,'beard'); p(ctx,20,23,3,3,'beardShade');
  p(ctx,19,21,3,3,'beard'); p(ctx,20,24,2,2,'beard');
  p(ctx,18-pose.arm,23,5,6,'outline'); p(ctx,19-pose.arm,24,3,4,'light');
  staff(ctx,-pose.arm,pose.cast);
  p(ctx,25,26-pose.arm*.5,4,2,'skinLight');
  hat(ctx);
  ctx.restore();
}

export function paintWizard(ctx, direction, pose) {
  // All poses share the robot's foot anchor and gameplay footprint.
  p(ctx,8,36,19,2,'#203b3b55');
  if (direction === 'left') { ctx.save(); ctx.translate(32,0); ctx.scale(-1,1); profile(ctx,pose); ctx.restore(); }
  else if (direction === 'right') profile(ctx,pose);
  else front(ctx,pose,direction === 'up');
}
