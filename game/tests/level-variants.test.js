import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_VARIANTS, levelVariantFor } from '../src/level-variants.js';
import { createChallenge, advanceChallenge, DEFAULT_MECHANICS } from '../src/challenge-rules.js';
import { createExpedition, LAYOUTS, SPAWN } from '../src/world.js';

test('route variants are explicit new-rule configurations and never alter old tickets', () => {
  assert.deepEqual(LEVEL_VARIANTS.map(({id,recommendedCharacter})=>({id,recommendedCharacter})),[
    {id:'pursuit',recommendedCharacter:'wizard'},{id:'machinery',recommendedCharacter:'robot'},
  ]);
  for(const rulesVersion of [undefined,1,2,3,4,5,6,7,8,9,10,11,12]) {
    const expedition=createExpedition('legacy-variant',{layoutId:'crossing',hazardCount:0});
    const base=createChallenge(expedition,{rulesVersion,mechanics:DEFAULT_MECHANICS});
    for(const variant of ['pursuit','machinery']) {
      assert.equal(levelVariantFor({rulesVersion,variant}),null);
      assert.deepEqual(createChallenge(expedition,{rulesVersion,variant,character:'robot',mechanics:DEFAULT_MECHANICS}),base);
    }
  }
  for(const variant of [undefined,'unknown'])assert.equal(levelVariantFor({rulesVersion:13,variant}),null);
  assert.equal(levelVariantFor({rulesVersion:13,variant:'pursuit'}),LEVEL_VARIANTS[0]);
});

test('pursuit removes environmental bottlenecks while machinery lowers hunter pressure on every map', () => {
  for(const {id:layoutId} of LAYOUTS)for(const tier of [0,5]) {
    const expedition=createExpedition(`variants:${layoutId}`,{layoutId,hazardCount:0});
    const options={rulesVersion:13,character:'wizard',tier,mechanics:DEFAULT_MECHANICS};
    const original=createChallenge(expedition,options);
    const pursuit=createChallenge(expedition,{...options,variant:'pursuit'});
    assert.equal(pursuit.traps.length,1);assert.equal(pursuit.terrain.lava.length,1);
    assert.equal(pursuit.terrain.lasers.length,0);assert.equal(pursuit.terrain.crumbles.length,1);
    assert.deepEqual(pursuit.traps,original.traps.slice(0,1));
    assert.deepEqual(pursuit.terrain.lava,original.terrain.lava.slice(0,1));
    assert.deepEqual(pursuit.terrain.hunter,original.terrain.hunter);
    const machinery=createChallenge(expedition,{...options,variant:'machinery'});
    assert.deepEqual(machinery.traps,original.traps);
    for(const key of ['lava','lasers','crumbles'])assert.deepEqual(machinery.terrain[key],original.terrain[key]);
    assert.equal(machinery.terrain.hunter.speed,original.terrain.hunter.speed*.75);
    assert.equal(machinery.terrain.hunter.wakeAt,4);
    const run={status:'running',collected:3,itemCount:6};
    advanceChallenge(pursuit,run,1/60,SPAWN);
    advanceChallenge(machinery,run,1/60,SPAWN);
    assert.equal(pursuit.terrain.hunter.state,'warning');assert.equal(machinery.terrain.hunter.state,'sleeping');
    run.collected=4;advanceChallenge(machinery,run,1/60,SPAWN);
    assert.equal(machinery.terrain.hunter.state,'warning');
  }
});
