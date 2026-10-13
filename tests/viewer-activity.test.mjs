import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabServers } from '../sources/server.mjs';
import { clone } from '../engine/determinism.mjs';

test('finite viewer activity requires observer authentication and scopes actor display to received data', async t => {
  const lab = await createLabServers({observerPort:0,sourcePort:0,persistCredentials:false,
    config:{scenario:'S23',organizations:2,grid:3,extentKm:2,policy:'none',hazard:'none',
      postsPerHour:0,backgroundTraffic:0,healthReports:false,recurringNeeds:false,packetLoss:0}});
  t.after(()=>lab.close());
  const base=`http://127.0.0.1:${lab.observerPort}`,source=`http://127.0.0.1:${lab.sourcePort}`,
    headers={Authorization:`Bearer ${lab.observerKey}`},
    actorKey=Object.entries(lab.actorKeys).find(([,a])=>a.org==='org0')[0];
  lab.world.inject('scenario_signal',{family:'P01',type:'text',text:'Families need water.',
    building:lab.world.state.map.shelterId,false:true,compositionMs:0});
  lab.world.advance(30000);
  const original=lab.world.state.posts.slice(0,1)[0];assert.ok(original);
  for(let i=0;i<280;i++)lab.world.state.posts.push({...clone(original),
    public:{...original.public,id:`activity-post-${i}`,publishedAt:0},indexAt:0,
    private:{...original.private,audience:'public',causeEvent:'private-cause',false:true}});
  lab.world.state.posts.push({...clone(original),public:{...original.public,id:'peer-private',publishedAt:0},
    indexAt:0,private:{...original.private,audience:['org1'],causeEvent:'private-peer'}});
  lab.world.state.posts.push({...clone(original),public:{...original.public,id:'future-post',publishedAt:999999},
    indexAt:999999,private:{...original.private,audience:'public'}});
  lab.world.state.ingestion.push({id:'activity-post-279',version:1,org:'org0',stage:'downloaded',at:0},
    {id:'peer-private',version:1,org:'org1',stage:'downloaded',at:0});
  for(let i=0;i<280;i++)lab.world.record('need_created',{org:'org1',privateMarker:`truth-${i}`});
  lab.world.record('query_completed',{org:'org0',target:'map'});
  const initial=lab.world.stateHash(),read=async suffix=>fetch(base+'/api/activity'+suffix,{headers});
  assert.equal((await fetch(base+'/api/activity')).status,401);
  assert.equal((await fetch(base+'/api/activity',{headers:{Authorization:`Bearer ${actorKey}`}})).status,401);
  assert.equal((await fetch(source+'/api/activity',{headers:{Authorization:`Bearer ${actorKey}`}})).status,404);
  assert.equal((await fetch(base+'/api/activity',{method:'POST',headers})).status,405);
  assert.equal((await read('?org=org0&perspective=org1')).status,400);
  assert.equal((await read('?org=missing&perspective=truth')).status,400);
  const actorResponse=await read('?org=org0&perspective=org0');assert.equal(actorResponse.status,200);
  const actor=await actorResponse.json();
  assert.equal(actor.sampleLimit,200);assert.equal(actor.runId,lab.world.runId);
  assert.ok(actor.state.posts.length<=200&&actor.state.posts.length>0);
  assert.ok(actor.state.posts.every(p=>p.public.publishedAt<=actor.now));
  assert.ok(!actor.state.posts.some(p=>['peer-private','future-post'].includes(p.public.id)));
  assert.ok(actor.state.posts.every(p=>!Object.hasOwn(p.private,'false')&&!Object.hasOwn(p.private,'causeEvent')));
  assert.deepEqual(Object.keys(actor.state.observations),['org0']);
  assert.ok(actor.state.ingestion.every(r=>r.org==='org0'));
  assert.equal(actor.events.length,1);assert.equal(actor.events[0].type,'query_completed');
  assert.equal(actor.state.map,undefined);assert.equal(actor.state.needs,undefined);
  const truthResponse=await read('?org=org0&perspective=truth');assert.equal(truthResponse.status,200);
  const truth=await truthResponse.json();
  assert.equal(truth.state.posts.length,200);assert.equal(truth.events.length,200);
  assert.ok(truth.state.posts.some(p=>p.private.causeEvent==='private-peer'));
  assert.ok(truth.events.some(e=>e.type==='need_created'));
  assert.equal(lab.world.stateHash(),initial,'presentation reads do not change physical state or attention');
});
