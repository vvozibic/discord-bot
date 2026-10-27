import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteGameStore } from '../server/game-store.js';

test('SQLite rollback cannot swallow a concurrent participant write on the shared connection', async () => {
  const store=createSqliteGameStore(':memory:',{eventId:'fixture',now:()=>1000});
  const board='fixture-board',userId='123456789012345678';
  let entered,release;
  const active=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  try {
    await store.upsertProfile(board,{id:userId,name:'Player',avatar:''});
    const transaction=store.transaction(board,userId,async tx=>{
      await tx.saveProgress('must-roll-back');
      entered();
      await gate;
      throw new Error('simulated failure');
    });
    await active;
    const participant=store.botStore.join('333333333333333333',{id:userId,name:'Player'});
    const rejected=assert.rejects(transaction,/simulated failure/);
    release();
    await rejected;
    await participant;
    assert.equal((await store.botStore.participant('333333333333333333',userId)).userId,userId);
    assert.equal((await store.transaction(board,userId,tx=>tx.profile())).progress,null);
  } finally {release?.();await store.close();}
});
