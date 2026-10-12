import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine/world.mjs';
import {createLabServers} from '../sources/server.mjs';
const config={seed:'platform-source-receipts',grid:5,extentKm:2,topology:'grid',hazard:'none',policy:'none',postsPerHour:60,backgroundTraffic:0,packetLoss:0,networkLatencyMs:1000};

test('batch ingestion acknowledges exact versions idempotently and does not accept nonexistent evidence',async t=>{
  const lab=await createLabServers({observerPort:0,sourcePort:0,persistCredentials:false,config});t.after(()=>lab.close());lab.world.advance(60000);
  const key=Object.entries(lab.actorKeys).find(([,a])=>a.org==='org0')[0],base=`http://127.0.0.1:${lab.sourcePort}`,headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  const feed=await(await fetch(base+'/api/feed?limit=20',{headers})).json();assert.ok(feed.posts.length);
  const item={id:feed.posts[0].id,version:feed.posts[0].version,stage:'accepted'};
  const send=items=>fetch(base+'/api/actor/ingestion/batch',{method:'POST',headers,body:JSON.stringify({items})}).then(r=>r.json());
  await send([{...item,stage:'downloaded'}]);
  const first=await send([item]);assert.equal(first[0].ok,true);
  const prior=lab.world.state.ingestion.length,again=await send([item]);assert.equal(again[0].receipt.duplicate,true);assert.equal(lab.world.state.ingestion.length,prior);
  const bad=await send([{...item,id:'nonexistent-post'}]);assert.equal(bad[0].ok,false);assert.equal(lab.world.state.ingestion.length,prior);
  const other=lab.world.actorView('org1');assert.equal(other.ingestion?.some(r=>r.org==='org0')??false,false);
});

test('facility status is observed only after its communication delay and closure revokes a stale safety status',()=>{
  const w=new World(config),b=w.building(w.state.map.shelterId);w.state.observations.org0.buildings[b.id]={id:b.id,safe:true,state:'candidate',version:b.version,at:0};
  b.state='operating';w.reportFacility(b);assert.equal(w.actorView('org0').known.buildings[b.id].state,'candidate');w.advance(10000);assert.equal(w.actorView('org0').known.buildings[b.id].state,'operating');
  w.closeFacility(b,'new structural damage');assert.equal(w.actorView('org0').known.buildings[b.id].safe,true);w.advance(20000);assert.equal(w.actorView('org0').known.buildings[b.id].safe,false);assert.equal(w.actorView('org0').known.buildings[b.id].state,'closed');assert.deepEqual(w.invariants(),[]);
});
