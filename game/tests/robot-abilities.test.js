import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, stepSimulation } from '../src/run-simulation.js';
import { startRun } from '../src/run-rules.js';
import { createFixedStepper } from '../src/timestep.js';
import { DEFAULT_MECHANICS, advanceChallenge, trapPhase, advancedHazard } from '../src/challenge-rules.js';
import { setMagicCharacter, castMagic, magicStatus } from '../src/magic-rules.js';
import { EMP_DURATION, EMP_COOLDOWN, EMP_RADIUS, ROBOT_HEAT_MULTIPLIER, empStatus, activateEmp, advanceEmp } from '../src/robot-abilities.js';

const disabled = Object.fromEntries(Object.keys(DEFAULT_MECHANICS).map(key => [key,false]));
const config = (mechanics = {}, extra = {}) => ({ rulesVersion:13,character:'robot',seed:'robot-contract',layoutId:'crossing',
  mode:'storm',enemies:[],timeLimit:150,scoreTimeLimit:150,mechanics:{ ...disabled,...mechanics },...extra });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function running(mechanics = {}, extra = {}) {
  const sim = createSimulation(config(mechanics,extra)); startRun(sim.run); return sim;
}
const trap = (x,y) => ({ x,y,radius:20,period:100,phase:94,warningDuration:1,activeDuration:10 });

test('ticket characters are locked in version thirteen while legacy character switching remains available', () => {
  for (const character of ['wizard','robot']) {
    const sim = createSimulation(config({}, { character }));
    assert.equal(sim.magic.character,character);
    assert.equal(Boolean(sim.emp),character === 'robot');
    for (const status of ['ready','running']) {
      sim.run.status = status;
      assert.equal(setMagicCharacter(sim,character === 'robot' ? 'wizard' : 'robot'),false);
      stepSimulation(sim,{ character:character === 'robot' ? 'wizard' : 'robot' });
      assert.equal(sim.magic.character,character);
    }
  }
  for (const rulesVersion of [9,10,11,12]) {
    const base = createSimulation(config({}, { rulesVersion }));
    const decorated = createSimulation(config({}, { rulesVersion,character:'wizard',variant:'machinery' }));
    assert.deepEqual(decorated.magic,base.magic);
    assert.deepEqual(decorated.challenge,base.challenge);
    assert.equal(Object.hasOwn(decorated,'emp'),false);
    assert.equal(setMagicCharacter(decorated,'wizard'),true);
    assert.equal(decorated.magic.character,'wizard');
    assert.equal(activateEmp(decorated),false);
  }
});

test('robot heating is exactly twenty percent slower while cooling and old tickets are unchanged', () => {
  assert.equal(ROBOT_HEAT_MULTIPLIER,.8);
  const wizard = running({ lava:true }, { character:'wizard' });
  const robot = running({ lava:true });
  const legacy = running({ lava:true }, { rulesVersion:12 });
  for (const sim of [wizard,robot,legacy]) {
    Object.assign(sim.player,sim.challenge.terrain.lava[0]);
    advanceChallenge(sim.challenge,sim.run,.4,sim.player);
  }
  close(wizard.challenge.terrain.heat,.8);
  close(robot.challenge.terrain.heat,.64);
  close(robot.challenge.terrain.heat,wizard.challenge.terrain.heat*.8);
  close(legacy.challenge.terrain.heat,wizard.challenge.terrain.heat);
  for (const sim of [wizard,robot,legacy]) {
    sim.challenge.terrain.heat = 1;
    advanceChallenge(sim.challenge,sim.run,.2,{ x:-100,y:-100 });
    close(sim.challenge.terrain.heat,.78);
  }
});

test('EMP suppresses only nearby trap centres and laser segments at a fixed cast origin', () => {
  const sim = running({ pulseTraps:true,lasers:true }), { x,y } = sim.player;
  sim.challenge.clock = 3;
  sim.challenge.traps = [trap(x+EMP_RADIUS,y),trap(x+EMP_RADIUS+.01,y)];
  sim.challenge.terrain.lasers = [
    { x1:x+90,x2:x+180,y,centerY:y,state:'active' },
    { x1:x+EMP_RADIUS+.01,x2:x+180,y,centerY:y,state:'active' },
  ];
  assert.equal(activateEmp(sim),true);
  assert.deepEqual(sim.emp.origin,{ x,y });
  assert.equal(sim.emp.radius,96); assert.equal(sim.emp.remaining,1.5); assert.equal(sim.emp.cooldown,10);
  assert.equal(trapPhase(sim.challenge.traps[0],3),'idle');
  assert.equal(trapPhase(sim.challenge.traps[1],3),'active');
  assert.equal(sim.challenge.terrain.lasers[0].state,'idle');
  assert.equal(sim.challenge.terrain.lasers[1].state,'active');
  assert.equal(Object.hasOwn(sim.challenge.traps[1],'suppressedUntil'),false);
  assert.equal(Object.hasOwn(sim.challenge.terrain.lasers[1],'suppressedUntil'),false);
  sim.player.x += 300;
  assert.deepEqual(sim.emp.origin,{ x,y },'the pulse does not follow the player');
  assert.equal(trapPhase(sim.challenge.traps[0],3+EMP_DURATION),'active');
});

test('EMP input prevents pulse damage in the activation tick and protection expires at 1.5 seconds', () => {
  const sim = running({ pulseTraps:true });
  sim.challenge.clock = 3;
  sim.challenge.traps = [trap(sim.player.x,sim.player.y)];
  const events = stepSimulation(sim,{ emp:true });
  assert.equal(events[0].type,'emp'); assert.equal(sim.run.hits,0);
  for (let tick=1;tick<89;tick++) stepSimulation(sim);
  assert.equal(sim.run.hits,0);
  assert.ok(sim.emp.remaining>0);
  stepSimulation(sim);
  assert.equal(sim.emp.remaining,0);
  assert.equal(sim.run.hits,1);
});

test('suppressed lasers recover their natural phase and collision at expiry', () => {
  const sim = running({ lasers:true }), laser = sim.challenge.terrain.lasers[0];
  sim.challenge.clock = 3;
  Object.assign(sim.player,{ x:(laser.x1+laser.x2)/2,y:laser.y });
  assert.equal(activateEmp(sim),true);
  advanceChallenge(sim.challenge,sim.run,EMP_DURATION-.01,sim.player);
  Object.assign(sim.player,{ y:laser.y });
  assert.equal(laser.state,'idle'); assert.equal(advancedHazard(sim.challenge,sim.player),null);
  advanceChallenge(sim.challenge,sim.run,.01,sim.player);
  Object.assign(sim.player,{ y:laser.y });
  assert.equal(laser.state,'active'); assert.equal(advancedHazard(sim.challenge,sim.player)?.type,'laser');

  const activated = running({ lasers:true }), activeLaser = activated.challenge.terrain.lasers[0];
  activated.challenge.clock = 4.5;
  advanceChallenge(activated.challenge,activated.run,.001,activated.player);
  Object.assign(activated.player,{ x:(activeLaser.x1+activeLaser.x2)/2,y:activeLaser.y });
  assert.equal(activeLaser.state,'active');
  assert.ok(stepSimulation(activated,{ emp:true }).some(event => event.type==='emp'));
  assert.equal(activated.run.hits,0);
  assert.equal(activeLaser.state,'idle');
});

test('EMP never grants immunity to lava, crumble tiles, or hunter contact and never stuns the hunter', () => {
  for (const type of ['lava','crumble','hunter']) {
    const sim = running({ [type]:true });
    const terrain = sim.challenge.terrain;
    if (type==='lava') { Object.assign(sim.player,terrain.lava[0]); terrain.heat=1; }
    if (type==='crumble') { Object.assign(sim.player,terrain.crumbles[0]); terrain.crumbles[0].state='active'; }
    if (type==='hunter') { Object.assign(sim.player,terrain.hunter); terrain.hunter.state='active'; }
    const hunterBefore = structuredClone(terrain.hunter);
    assert.equal(activateEmp(sim),true);
    assert.equal(advancedHazard(sim.challenge,sim.player)?.type,type);
    assert.deepEqual(terrain.hunter,hunterBefore);
    assert.equal(sim.run.shieldRemaining,0);
  }
});

test('EMP enforces cooldown, stagger and run status, including a pulse with no nearby targets', () => {
  const sim = createSimulation(config());
  assert.equal(empStatus(sim).label,'Move first'); assert.equal(activateEmp(sim),false);
  startRun(sim.run); sim.run.staggerRemaining=.1;
  assert.equal(empStatus(sim).label,'Staggered'); assert.equal(activateEmp(sim),false);
  sim.run.staggerRemaining=0;
  assert.equal(activateEmp(sim),true); assert.equal(sim.emp.uses,1);
  assert.equal(activateEmp(sim),false);
  advanceEmp(sim,EMP_COOLDOWN-.01);
  assert.equal(sim.emp.remaining,0); assert.equal(activateEmp(sim),false);
  advanceEmp(sim,.01);
  assert.equal(empStatus(sim).ready,true); assert.equal(activateEmp(sim),true); assert.equal(sim.emp.uses,2);
  for (const status of ['ready','won','failed']) {
    sim.run.status=status;
    const previous=structuredClone(sim.emp);
    advanceEmp(sim,20); assert.deepEqual(sim.emp,previous); assert.equal(activateEmp(sim),false);
  }
  assert.equal(empStatus(running({}, { character:'wizard' })).label,'Robot only');
});

test('robot EMP and hazard suppression use identical simulation state at 30, 60 and 144 rendering frames per second', () => {
  function play(fps) {
    const sim=running({ pulseTraps:true,lasers:true }), {x,y}=sim.player;
    sim.challenge.traps=[trap(x+50,y)];
    sim.challenge.terrain.lasers=[{x1:x+50,x2:x+90,y,centerY:y,state:'idle'}];
    let tick=0;
    const stepper=createFixedStepper(dt=>{stepSimulation(sim,{emp:tick===0||tick===600},dt);tick++;});
    for(let frame=0;frame<fps*12;frame++) stepper.advance(1/fps);
    assert.equal(tick,720); assert.equal(sim.emp.uses,2);
    return {run:sim.run,emp:sim.emp,challenge:sim.challenge,player:sim.player};
  }
  const baseline=play(60);
  assert.deepEqual(play(30),baseline); assert.deepEqual(play(144),baseline);
});

test('wizard magic and movement remain identical to version twelve when no route variant is selected', () => {
  function play(rulesVersion) {
    const sim=running({hunter:true},{rulesVersion,character:'wizard'});
    if(rulesVersion<13)setMagicCharacter(sim,'wizard');
    Object.assign(sim.player,{x:360,y:368});
    Object.assign(sim.challenge.terrain.hunter,{x:360,y:200,state:'active',speed:0});
    assert.equal(magicStatus(sim).ready,true); assert.equal(castMagic(sim),true);
    for(let tick=0;tick<180;tick++)stepSimulation(sim);
    assert.equal(sim.magic.hits,1);
    assert.equal(Object.hasOwn(sim,'emp'),false);
    return {run:sim.run,magic:sim.magic,challenge:sim.challenge,player:sim.player};
  }
  assert.deepEqual(play(13),play(12));
});
