import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createGameApi } from '../server/api.js';
import { createSqliteGameStore } from '../server/game-store.js';
import { openPostgresGameStore } from '../server/postgres-store.js';
import { recordedVictory } from './fixtures/ranked-run.js';
import { CHALLENGE_RULES_VERSION } from '../src/challenge-rules.js';
import { DEFAULT_EQUIPPED } from '../src/rewards.js';

const USERS = {alice:'123456789012345678',bob:'223456789012345678'}, GUILD='333333333333333333';
const all = ['clean-run','bonus-sweep','hunter-slayer'];
const empty = {unlocked:[],equipped:DEFAULT_EQUIPPED};
const styled = {palette:'moonlight',trail:'spark',badge:'hunter'};

async function fixture(options) {
  const database = options.databaseUrl ? await openPostgresGameStore(options.databaseUrl) : createSqliteGameStore(options.path);
  const store = { ...database, async upsertProfile(board, profile) {
    await database.upsertProfile(board, profile);
    await database.transaction(board, profile.id, async tx => {
      const row = await tx.profile();
      // Keep this verified achievement scenario on its original clear route,
      // independent of how many maps the campaign rotation contains.
      if (row && row.progress == null) await tx.saveProgress(JSON.stringify({
        version:1, seed:'rewards-4', level:1, skill:0, streak:0, attempt:0, recentMaps:[],
        active:{ level:1, layoutId:'crossing', tier:0, attempt:0, status:'ready',
          rulesVersion:CHALLENGE_RULES_VERSION, character:'wizard', variant:'pursuit' },
      }));
    });
  } };
  const faultableStore = { ...store, transaction:(board,userId,action) => store.transaction(board,userId,tx => action({ ...tx,
    addScore:(...args) => { if (options.failScores) throw new Error('Simulated persistence failure'); return tx.addScore(...args); },
  })) };
  const api = createGameApi({clientId:'1466831420575186985',eventId:options.eventId,gameStore:faultableStore,now:()=>options.clock.time,
    authenticate:async({code}) => {
      if (!USERS[code]) throw new Error('Not a fixture user');
      return {profile:{id:USERS[code],name:code,avatar:''},accessToken:'test-token',expiresIn:3600};
    }});
  const server = createServer((req,res)=>api.handle(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  async function request(path,{token,body,method=body?'POST':'GET'}={}) {
    const res=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,
      headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,body:await res.json()};
  }
  return {request,login:async(code,guildId=GUILD)=>(await request('/discord/session',{body:{code,guildId}})).body,
    close:async()=>{await new Promise(resolve=>server.close(resolve));await api.close();}};
}

for (const backend of ['sqlite','postgres']) test(`${backend}: verified achievements, selection, leaderboard badge and restart remain isolated and durable`,
  {skip:backend==='postgres'&&!process.env.GAME_TEST_DATABASE_URL,timeout:30000}, async()=>{
    const directory=mkdtempSync(join(tmpdir(),'forest-rewards-api-'));
    const options={path:join(directory,'game.sqlite'),eventId:`rewards-${randomUUID()}`,clock:{time:1000000},
      databaseUrl:backend==='postgres'?process.env.GAME_TEST_DATABASE_URL:undefined};
    let f=await fixture(options);
    try {
      assert.equal((await f.request('/rewards')).status,401);
      const alice=await f.login('alice'),bob=await f.login('bob'),other=await f.login('alice','444444444444444444');
      assert.deepEqual(alice.rewards,empty);
      assert.equal((await f.request('/rewards',{token:alice.token,method:'PUT',body:{equipped:styled}})).status,400);
      assert.equal((await f.request('/rewards',{token:alice.token,method:'PUT',body:{equipped:DEFAULT_EQUIPPED,unlocked:all}})).status,400);
      const plan=(await f.request('/runs',{token:alice.token,body:{}})).body;
      assert.equal(plan.config.layoutId,'crossing');
      const fabricated=await f.request('/runs/finish',{token:alice.token,body:{ticket:plan.ticket,trace:[],hits:0,bonuses:2,hunterDefeated:true}});
      assert.equal(fabricated.status,422);
      assert.deepEqual((await f.request('/rewards',{token:alice.token})).body,empty);
      const recording=recordedVictory(plan.config);
      options.clock.time+=(recording.seconds+1)*1000;
      const body={ticket:plan.ticket,trace:recording.trace};
      options.failScores=true;
      assert.equal((await f.request('/runs/finish',{token:alice.token,body})).status,500);
      assert.deepEqual((await f.request('/rewards',{token:alice.token})).body,empty,'achievements roll back with a failed score write');
      assert.equal((await f.request('/runs',{token:alice.token,body:{}})).body.ticket,plan.ticket);
      options.failScores=false;
      const [first,duplicate]=await Promise.all([f.request('/runs/finish',{token:alice.token,body}),f.request('/runs/finish',{token:alice.token,body})]);
      assert.equal(first.status,200);assert.equal(first.body.status,'won');
      assert.deepEqual(first.body.newAchievements,all);
      assert.deepEqual(first.body.rewards,{unlocked:all,equipped:DEFAULT_EQUIPPED});
      assert.deepEqual(duplicate.body,first.body);
      assert.deepEqual((await f.request('/rewards',{token:bob.token})).body,empty);
      assert.deepEqual((await f.request('/rewards',{token:other.token})).body,empty);
      assert.equal((await f.request('/runs/finish',{token:bob.token,body})).status,404);
      assert.equal((await f.request('/rewards',{token:alice.token,method:'PUT',body:{equipped:{...styled,badge:'fake'}}})).status,400);
      const equipped=await f.request('/rewards',{token:alice.token,method:'PUT',body:{equipped:styled}});
      assert.equal(equipped.status,200);assert.deepEqual(equipped.body,{unlocked:all,equipped:styled});
      assert.deepEqual((await f.request('/runs/finish',{token:alice.token,body})).body.rewards,equipped.body,'retrying a finished submission cannot roll back newly selected cosmetics');
      const board=(await f.request('/leaderboard',{token:alice.token})).body;
      assert.equal(board.you.badge,'hunter');assert.equal(board.total,1);
      assert.equal('rewards' in board.you,false,'private reward state is not returned in rankings');
      await f.close();f=await fixture(options);
      const reconnected=await f.login('alice');
      assert.deepEqual(reconnected.rewards,{unlocked:all,equipped:styled});
      assert.deepEqual((await f.request('/rewards',{token:reconnected.token})).body,reconnected.rewards);
      assert.equal((await f.request('/runs',{token:reconnected.token,body:{}})).body.config.level,2);
    } finally {
      await f.close();
      if(options.databaseUrl){
        const pool=new Pool({connectionString:options.databaseUrl});
        try {for(const table of ['forest_scores','forest_attempts','forest_profiles']) await pool.query(`DELETE FROM ${table} WHERE board IN ($1,$2)`,[`guild:${GUILD}:event:${options.eventId}`,`guild:444444444444444444:event:${options.eventId}`]);}
        finally {await pool.end();}
      }
      rmSync(directory,{recursive:true,force:true});
    }
  });
