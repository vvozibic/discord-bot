import test from 'node:test';
import assert from 'node:assert/strict';
import {SPAWN,PORTAL,COLLECTIBLES,PLAYER_SPEED,GUARDIAN,canStand,movePlayer,findPath,clearSegment,followPath} from '../src/world.js';
import {createFixedStepper} from '../src/timestep.js';

test('diagonal movement has the same speed as horizontal movement',()=>{
  const origin={x:320,y:336};
  const straight={...origin},diagonal={...origin};
  for(let i=0;i<5;i++){movePlayer(straight,1,0,.04);movePlayer(diagonal,1,1,.04);}
  assert.ok(Math.abs(Math.hypot(straight.x-origin.x,straight.y-origin.y)-Math.hypot(diagonal.x-origin.x,diagonal.y-origin.y))<1e-8);
});
test('water blocks walking but the bridge is passable',()=>{
  assert.equal(canStand(480,144),false);
  assert.equal(canStand(560,144),true);
  assert.equal(canStand(620,144),false);
  const player={x:500,y:280};
  for(let i=0;i<100;i++)movePlayer(player,0,-1,10);
  assert.ok(player.y>=259);
  assert.ok(canStand(player.x,player.y));
  assert.equal(canStand(-10,-10),false);
});
test('every pulse cube and the portal can be reached by continuous movement',()=>{
  const player={...SPAWN};
  for(const destination of[...COLLECTIBLES,PORTAL]){
    const path=findPath(player,destination);
    assert.ok(path.length>0,`No path to ${JSON.stringify(destination)}`);
    for(const waypoint of path){
      let iterations=0;
      while(Math.hypot(waypoint.x-player.x,waypoint.y-player.y)>.01){
        const dx=waypoint.x-player.x,dy=waypoint.y-player.y,distance=Math.hypot(dx,dy);
        assert.ok(movePlayer(player,dx,dy,Math.min(.04,distance/PLAYER_SPEED)),'A path segment is blocked');
        assert.ok(canStand(player.x,player.y));
        assert.ok(++iterations<100,'Walking got stuck');
      }
    }
    assert.ok(Math.hypot(player.x-destination.x,player.y-destination.y)<13);
  }
});
test('walking speed stays constant at 60, 30, 20, 10 and 5 FPS',()=>{
  for(const fps of[60,30,20,10,5]){
    const player={x:320,y:336};
    const stepper=createFixedStepper(dt=>movePlayer(player,1,0,dt));
    for(let i=0;i<fps;i++)stepper.advance(1/fps);
    assert.ok(Math.abs(player.x-320-PLAYER_SPEED)<1e-7,`Movement slowed at ${fps} FPS`);
  }
});
test('direct clicks use the exact point instead of snapping to tile centers',()=>{
  const target={x:373,y:330};
  assert.equal(clearSegment(SPAWN,target),true);
  assert.deepEqual(findPath(SPAWN,target),[target]);
});
test('following a path consumes leftover travel across waypoint boundaries',()=>{
  const player={x:320,y:336};
  const path=[{x:321,y:336},{x:330,y:336}];
  followPath(player,path,1/60);
  assert.ok(Math.abs(player.x-(320+PLAYER_SPEED/60))<1e-8);
  assert.equal(path.length,1);
});
test('rocks and the guardian have collisions',()=>{
  assert.equal(canStand(420,352),false);
  assert.equal(canStand(GUARDIAN.x,GUARDIAN.y),false);
});
test('clicking water or outside the map does not create a route',()=>{
  assert.deepEqual(findPath(SPAWN,{x:480,y:144}),[]);
  assert.deepEqual(findPath(SPAWN,{x:900,y:352}),[]);
});
