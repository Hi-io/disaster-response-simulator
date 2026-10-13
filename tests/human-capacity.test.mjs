import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay } from '../evaluation/runs.mjs';
import { normalizeHumanCapacity } from '../contracts/human-capacity.mjs';
import { createLabServers } from '../sources/server.mjs';
import { evaluate } from '../evaluation/metrics.mjs';

const config={scenario:'S23',policy:'none',seed:'human-capacity-fixed-events',hazard:'none',grid:3,extentKm:1,
  organizations:2,backgroundTraffic:0,postsPerHour:0,healthReports:false,recurringNeeds:false,packetLoss:0,
  networkLatencyMs:1000,queryLatencyMs:1000,reviewMs:1000,durationMs:3600000};
const actor=(org='org0',role='agent')=>({id:'stable-actor-'+org,org,role});
const act=(w,type,params,key)=>w.act(actor(),{type,params,idempotencyKey:key});
const work=(w,stage,reference,key,extra={})=>act(w,'human_work',{stage,reference,...extra},key);
const needRef=()=>({kind:'need',id:'need-water-main',version:1});
const task=(w,id)=>w.actorView('org0').humanWork.find(t=>t.id===id);
const active={profile:'moderate',readers:1,deciders:1,relayers:1,readMs:1000,decisionMs:2000,relayMs:3000};

test('human profile assumptions are explicit bounded and zero retains legacy owner review scheduling',()=>{
  assert.throws(()=>normalizeHumanCapacity({profile:'realistic'}));
  assert.throws(()=>normalizeHumanCapacity({profile:'moderate',readers:0}));
  assert.throws(()=>normalizeHumanCapacity({profile:'zero',secretTruth:true}));
  for(const profile of ['zero','moderate','burst'])assert.equal(normalizeHumanCapacity({profile}).readErrorBp,0);
  const w=new World(config);const commander=actor('org0','commander');
  const p=w.act(commander,{type:'propose',params:{title:'Zero profile',plan:{}},idempotencyKey:'zero-propose'});
  const q=w.act(commander,{type:'review',params:{id:p.id,decision:'approve'},idempotencyKey:'zero-review'});
  assert.equal(q.readyAt,1000);assert.equal(q.humanCapacity,undefined);w.advance(1000);
  assert.equal(w.actorView('org0').proposals[0].state,'authorized');assert.equal(w.state.humanWork,undefined);
  w.close();
});

test('finite native readers increase real queue wait and expose only completed received payloads',()=>{
  const w=new World({...config,humanCapacity:active}),a=work(w,'read',needRef(),'read-1'),b=work(w,'read',needRef(),'read-2'),c=work(w,'read',needRef(),'read-3');
  assert.equal(a.state,'working');assert.equal(b.state,'queued');assert.equal(c.state,'queued');assert.equal(a.result,undefined);
  w.advance(1000);assert.equal(task(w,a.id).completedAt,1000);assert.equal(task(w,b.id).startedAt,1000);
  w.advance(3000);assert.equal(task(w,b.id).queueMs,1000);assert.equal(task(w,c.id).queueMs,2000);
  assert.equal(task(w,c.id).result.snapshot.quantity,600);
  assert.equal(w.actorView('org1').humanWork.length,0);assert.equal(w.actorView('org1').humanCapacity.maximumBacklog,0);
  assert.equal(JSON.stringify(w.actorView('org0').humanCapacity).includes('privatePayload'),false);
  assert.equal(w.state.operations.length,0);assert.equal(w.need('need-water-main').served,0);w.close();
});

test('read→decision→physical relay changes partner cache only on actual received message, not completion of a mental step',()=>{
  const w=new World({...config,humanCapacity:active});
  // Recipient knew an older demand. The sender relays its exact already received
  // observation, without reading current private demand at task completion.
  w.state.observations.org1.needs={};
  const read=work(w,'read',needRef(),'chain-read');
  const decide=work(w,'decide',{kind:'work',id:read.id},'chain-decide',{dependsOn:[read.id]});
  const relay=w.act(actor('org0','commander'),{type:'human_work',params:{stage:'relay',reference:{kind:'work',id:decide.id},
    dependsOn:[decide.id],recipient:'org1'},idempotencyKey:'chain-relay'});
  w.updateNeed('need-water-main',{quantity:650}); // No new delivered observation.
  w.advance(5999);assert.equal(w.actorView('org1').humanInbox.length,0);assert.equal(w.actorView('org1').known.needs['need-water-main'],undefined);
  w.advance(6000);assert.equal(task(w,relay.id).state,'awaiting_delivery');assert.equal(w.actorView('org1').humanInbox.length,0);
  w.advance(8000);const inbox=w.actorView('org1').humanInbox[0];assert.equal(inbox.snapshot.quantity,600);
  assert.equal(inbox.source.version,1);assert.equal(inbox.sourceObservedAt,0);assert.ok(inbox.receivedAt>6000);
  assert.equal(w.actorView('org1').known.needs['need-water-main'].quantity,600);
  assert.equal(w.need('need-water-main').quantity,650);assert.equal(w.need('need-water-main').served,0);
  assert.equal(w.actorView('org1').proposals.length,0);assert.deepEqual(w.invariants(),[]);w.close();
});

test('finite native decision pool is shared by manual planning and actual independent owner reviews',()=>{
  const w=new World({...config,humanCapacity:active}),commander=actor('org0','commander');
  const decision=work(w,'decide',needRef(),'manual-decision');
  const p=w.act(commander,{type:'propose',params:{title:'Owner review waits',references:['need-water-main'],plan:{}},idempotencyKey:'pooled-propose'});
  const review=w.act(commander,{type:'review',params:{id:p.id,decision:'approve'},idempotencyKey:'pooled-review'});
  assert.equal(review.readyAt,null);w.advance(1999);assert.equal(w.actorView('org0').proposals[0].state,'awaiting_approval');
  w.advance(2000);assert.equal(task(w,decision.id).state,'completed');w.advance(3000);
  assert.equal(w.actorView('org0').proposals[0].state,'authorized');assert.equal(task(w,review.task).queueMs,2000);
  assert.equal(w.state.operations.length,0,'Approval itself is not physical service');w.close();
});

test('stale review scope cannot overwrite a new version and finite rechecks do not create automatic authority',()=>{
  const w=new World({...config,humanCapacity:{...active,decisionErrorBp:10000}}),commander=actor('org0','commander');
  const p=w.act(commander,{type:'propose',params:{title:'Needs human recheck',plan:{}},idempotencyKey:'error-propose'});
  const q=w.act(commander,{type:'review',params:{id:p.id,decision:'approve'},idempotencyKey:'error-review'});
  w.advance(1000);assert.equal(task(w,q.task).state,'inconclusive');assert.notEqual(w.actorView('org0').proposals[0].state,'authorized');
  assert.equal(w.state.operations.length,0);w.close();
  const x=new World({...config,humanCapacity:active});const pp=x.act(commander,{type:'propose',params:{title:'Stale scope',plan:{}},idempotencyKey:'stale-propose'});
  const r=x.act(commander,{type:'review',params:{id:pp.id,decision:'approve'},idempotencyKey:'stale-review'});
  x.state.proposals[0].plan={changed:true};x.state.proposals[0].version++;
  x.advance(1000);assert.equal(task(x,r.task).reason,'review_scope_changed');assert.equal(x.actorView('org0').proposals[0].state,'awaiting_approval');x.close();
});

test('own receipts/prerequisites/version/authority cannot be spoofed, and finite backlog rejection adds no cargo',()=>{
  const w=new World({...config,humanCapacity:{...active,queueLimit:2}}),read=work(w,'read',needRef(),'privacy-read');
  assert.throws(()=>w.act(actor('org1'),{type:'human_work',params:{stage:'decide',reference:{kind:'work',id:read.id},dependsOn:[read.id]},idempotencyKey:'steal-work'}),e=>e.code==='HUMAN_DEPENDENCIES');
  assert.throws(()=>work(w,'read',{...needRef(),version:100},'future-version'),e=>e.code==='VERSION_CONFLICT');
  assert.throws(()=>w.act(actor('org0','observer'),{type:'human_work',params:{stage:'read',reference:needRef()},idempotencyKey:'observer-work'}),e=>e.code==='FORBIDDEN');
  assert.throws(()=>work(w,'relay',needRef(),'agent-private-relay',{recipient:'org1'}),e=>e.code==='FORBIDDEN');
  work(w,'read',needRef(),'queue-second');assert.throws(()=>work(w,'read',needRef(),'queue-full'),e=>e.code==='HUMAN_BACKLOG');
  assert.equal(w.state.operations.length,0);assert.equal(w.state.vehicles.some(v=>v.load>0),false);
  const inventory=w.resource('r-org0-water').quantity;
  assert.throws(()=>act(w,'query',{target:'human_work',org:'org1'},'private-query'),e=>e.code==='FORBIDDEN');
  assert.equal(w.resource('r-org0-water').quantity,inventory);assert.deepEqual(w.invariants(),[]);w.close();
});

test('offline relay retains actual connectivity delay and expires without fake cache arrival',()=>{
  const w=new World({...config,humanCapacity:active}),recipient=w.organization('org1');recipient.connected=false;
  const relay=w.act(actor('org0','commander'),{type:'human_work',params:{stage:'relay',reference:needRef(),recipient:'org1',ttlMs:1000},idempotencyKey:'offline-relay'});
  w.advance(5000);assert.equal(task(w,relay.id).state,'failed');assert.equal(task(w,relay.id).reason,'delivery_expired');
  assert.equal(w.actorView('org1').humanInbox.length,0);assert.equal(w.need('need-water-main').served,0);w.close();
});

test('source keyed exogenous workload and attention draws reproduce exactly; extra reads/idempotency do not reroll work',()=>{
  const inputs={...config,humanCapacity:{...active,profile:'burst',backgroundReadPerHour:120,
    backgroundDecisionPerHour:60,backgroundRelayPerHour:60,readErrorBp:5000}};
  const a=new World(inputs),b=new World(inputs);
  const first=work(a,'read',needRef(),'repeat-key'),other=work(b,'read',needRef(),'repeat-key');assert.equal(first.id,other.id);
  const repeat=work(a,'read',needRef(),'repeat-key');assert.equal(repeat.id,first.id);assert.equal(a.state.humanWork.length,1);
  // External replay inputs include the duplicate action, so hashes are expected
  // to differ; event-key latent work and exogenous task sequence must not.
  for(let i=0;i<30;i++)a.actorView('org0');a.advance(180000);b.advance(180000);
  assert.deepEqual(a.state.humanWork,b.state.humanWork);assert.deepEqual(a.state.humanCapacity,b.state.humanCapacity);
  const r=replay(a.checkpoint());assert.equal(r.matches,true);assert.deepEqual(a.invariants(),[]);r.world.close();a.close();b.close();
});

test('real ordinary HTTP submits and queries only actor-owned work without observer authority or a model',async t=>{
  const lab=await createLabServers({observerPort:0,sourcePort:0,persistCredentials:false,config:{...config,humanCapacity:active}});t.after(()=>lab.close());
  const key=Object.entries(lab.actorKeys).find(([,a])=>a.org==='org0')[0],base='http://127.0.0.1:'+lab.sourcePort;
  const headers={Authorization:'Bearer '+key,'Content-Type':'application/json'};
  const submitted=await fetch(base+'/api/actor/action',{method:'POST',headers,body:JSON.stringify({type:'human_work',params:{stage:'read',reference:needRef()},idempotencyKey:'http-human-read'})});
  assert.equal(submitted.status,200);const receipt=await submitted.json();assert.equal(receipt.state,'working');
  assert.equal((await fetch(base+'/api/actor/state')).status,401);lab.world.advance(2000);
  const received=await(await fetch(base+'/api/actor/state',{headers})).json();assert.equal(received.humanWork.find(t=>t.id===receipt.id).state,'completed');
  assert.equal(received.humanWork[0].result.snapshot.quantity,600);assert.equal(received.state,undefined);
  const privateQuery=await fetch(base+'/api/actor/action',{method:'POST',headers,body:JSON.stringify({type:'query',params:{target:'human_work',org:'org1'},idempotencyKey:'http-private-human-query'})});
  assert.equal(privateQuery.status,403);assert.equal(lab.world.state.modelCalls,0);
});

test('human stage metrics retain unfinished backlog and its actual waiting instead of counting pending records as processed',()=>{
  const w=new World({...config,humanCapacity:active});
  for(let i=0;i<3;i++)work(w,'read',needRef(),'metric-read-'+i);
  w.advance(1500);const m=evaluate(w).humanCapacity.stages.read;
  assert.equal(m.received,3);assert.equal(m.completed,1);assert.equal(m.working,1);assert.equal(m.queued,1);
  assert.equal(m.elapsedWorkPersonMs,1500);assert.equal(m.elapsedQueuePersonMs,2500);
  assert.equal(m.pendingCensored,2);assert.equal(m.pendingCensoredAt,1500);assert.equal(m.finishedTurnaroundMs.samples,1);
  assert.equal(evaluate(w).services.water.served,0);w.close();
});

test('background relay occupies its finite declared relay pool without manufacturing incoming reports',()=>{
  const w=new World({...config,humanCapacity:{...active,backgroundRelayPerHour:120,backgroundReadPerHour:0,backgroundDecisionPerHour:0}});
  w.advance(0);const rows=w.state.humanWork.filter(t=>t.org==='org0');
  assert.equal(rows.length,2);assert.deepEqual(rows.map(t=>t.stage),['relay','relay']);
  assert.equal(rows.filter(t=>t.state==='working').length,1);assert.equal(w.actorView('org0').humanInbox.length,0);
  w.advance(6000);assert.ok(rows.every(t=>t.state==='completed'));assert.equal(w.actorView('org1').humanInbox.length,0);
  assert.equal(evaluate(w).humanCapacity.stages.relay.elapsedWorkPersonMs,12000);w.close();
});

test('offline sender delays real relay transmission, and restoring a channel permits actual receipt',()=>{
  const w=new World({...config,humanCapacity:active}),origin=w.organization('org0');origin.connected=false;
  const r=w.act(actor('org0','commander'),{type:'human_work',params:{stage:'relay',reference:needRef(),recipient:'org1'},idempotencyKey:'origin-offline'});
  w.advance(20000);assert.equal(task(w,r.id).state,'awaiting_delivery');assert.equal(w.actorView('org1').humanInbox.length,0);
  origin.connected=true;w.advance(40000);assert.equal(task(w,r.id).state,'completed');assert.equal(w.actorView('org1').humanInbox.length,1);
  assert.equal(w.actorView('org1').humanInbox[0].sourceObservedAt,0);w.close();
});

test('owner-authorized delayed intents and operation notices expose only sanitized received coordination data',()=>{
  const w=new World({...config,humanCapacity:active,loadMs:1000,unloadMs:1000}),owner=actor('org0','commander');
  const parameters={resource:'r-org0-water',vehicle:'v-org0-0',need:'need-water-main',quantity:100};
  const p=w.act(owner,{type:'propose',params:{title:'Sensitive internal title',references:['need-water-main'],
    plan:{privateNotes:'never share',actions:[{type:'dispatch',params:parameters},{type:'purchase',params:{price:999,resource:'secret-stock'}}]}},idempotencyKey:'intent-plan'});
  assert.throws(()=>work(w,'relay',{kind:'proposal',id:p.id,version:1},'unapproved-intent-share',{recipient:'org1'}),e=>e.code==='FORBIDDEN');
  const sent=w.act(owner,{type:'human_work',params:{stage:'relay',reference:{kind:'proposal',id:p.id,version:1},recipient:'org1'},idempotencyKey:'share-intent'});
  assert.equal(w.actorView('org1').known.peerIntents,undefined);w.advance(5000);
  const notice=w.actorView('org1').known.peerIntents['org0:'+p.id];
  assert.equal(notice.snapshot.shareScope,'owner_intent');assert.equal(notice.snapshot.actions.length,1);
  assert.equal(notice.snapshot.actions[0].params.quantity,100);assert.equal(notice.snapshot.actions[0].resourceType,'water');
  for(const hidden of ['privateNotes','Sensitive internal title','r-org0-water','v-org0-0','secret-stock','authorizedBy'])
    assert.equal(JSON.stringify(notice).includes(hidden),false,hidden);
  assert.equal(task(w,sent.id).state,'completed');assert.equal(w.actorView('org1').proposals.length,0);
  const review=w.act(owner,{type:'review',params:{id:p.id,decision:'approve'},idempotencyKey:'intent-review'});w.advance(6000);
  assert.equal(task(w,review.task).state,'completed');
  const op=w.act(owner,{type:'dispatch',params:parameters,idempotencyKey:'notice-dispatch'});
  const shared=w.act(owner,{type:'human_work',params:{stage:'relay',reference:{kind:'operation',id:op.id,version:op.version},recipient:'org1'},idempotencyKey:'share-op'});
  w.advance(11000);const received=w.actorView('org1').known.peerOperations['org0:'+op.id];
  assert.equal(received.source.version,op.version);assert.equal(received.snapshot.quantity,100);assert.equal(received.snapshot.received,0);
  assert.equal(received.snapshot.state,'reserved','Late shared acknowledgment is not current truth or completion');
  for(const hidden of ['r-org0-water','v-org0-0','commitment','authorizedBy'])assert.equal(JSON.stringify(received).includes(hidden),false);
  assert.equal(task(w,shared.id).state,'completed');assert.equal(w.state.operations.filter(x=>x.org==='org1').length,0);
  assert.throws(()=>w.act(actor('org1','commander'),{type:'human_work',params:{stage:'relay',reference:{kind:'operation',id:op.id},recipient:'org0'},idempotencyKey:'steal-op'}),e=>e.code==='HUMAN_REFERENCE');
  w.close();
});

test('actual competing deliveries can duplicate stale demand; native reviews, stocks, finite trips and replay remain intact',()=>{
  const w=new World({...config,humanCapacity:{...active,relayMs:300000},loadMs:1000,unloadMs:1000});
  const proposals=[];
  for(const org of ['org0','org1']){
    const read=w.act(actor(org),{type:'human_work',params:{stage:'read',reference:needRef()},idempotencyKey:'duplicate-read'});
    w.act(actor(org),{type:'human_work',params:{stage:'decide',reference:{kind:'work',id:read.id},dependsOn:[read.id]},idempotencyKey:'duplicate-decide'});
    const actions=[0,1].map(j=>({type:'dispatch',params:{resource:'r-'+org+'-water',vehicle:'v-'+org+'-'+j,need:'need-water-main',quantity:300}}));
    const p=w.act(actor(org,'commander'),{type:'propose',params:{title:'Own received demand',references:['need-water-main'],plan:{actions}},idempotencyKey:'duplicate-propose'});
    w.act(actor(org,'commander'),{type:'review',params:{id:p.id,decision:'approve'},idempotencyKey:'duplicate-review'});proposals.push({org,id:p.id,actions});
  }
  w.advance(4000);
  for(const p of proposals){
    const received=w.actorView(p.org);assert.equal(received.proposals.find(x=>x.id===p.id).state,'authorized');
    assert.equal(received.known.needs['need-water-main'].served,0);
    const version=received.proposals.find(x=>x.id===p.id).version;
    w.act(actor(p.org,'commander'),{type:'human_work',params:{stage:'relay',reference:{kind:'proposal',id:p.id,version},recipient:p.org==='org0'?'org1':'org0'},idempotencyKey:'delayed-intent'});
    for(const [step,a] of p.actions.entries())w.act(actor(p.org,'commander'),{type:a.type,params:{...a.params,proposal:p.id,step},idempotencyKey:'competing-dispatch-'+step});
  }
  assert.equal(w.state.operations.length,4);assert.equal(w.need('need-water-main').served,0);
  assert.throws(()=>w.act(actor('org0','commander'),{type:'dispatch',params:{resource:'r-org1-water',vehicle:'v-org0-0',need:'need-water-main',quantity:1},idempotencyKey:'foreign-resource'}));
  let steps=0;while(w.state.operations.some(o=>o.state!=='completed')&&steps++<20000)assert.ok(w.step());
  assert.ok(w.state.operations.every(o=>o.state==='completed'));assert.equal(w.state.operations.reduce((s,o)=>s+o.received,0),1200);
  assert.equal(w.need('need-water-main').served,1200);assert.equal(evaluate(w).services.water.served,600);
  assert.equal(evaluate(w).services.water.overprovided,600);
  for(const org of ['org0','org1']){
    const r=w.resource('r-'+org+'-water');assert.equal(r.transferred,600);assert.equal(r.quantity,600);assert.equal(r.reserved,0);assert.equal(r.floor,100);
    assert.equal(w.state.operations.filter(o=>o.org===org).length,2);
  }
  assert.ok(w.state.vehicles.every(v=>v.load===0));assert.deepEqual(w.invariants(),[]);
  w.advance(w.now);const replayed=replay(w.checkpoint());assert.equal(replayed.matches,true);assert.deepEqual(replayed.world.invariants(),[]);
  replayed.world.close();w.close();
});

test('a revoked queued public relay fails without leaking content or stranding unrelated work and dependent stages',()=>{
  const w=new World({...config,humanCapacity:active});
  w.inject('scenario_signal',{family:'P01',building:w.state.map.shelterId,text:'Original source later deleted',false:false,
    causeEvent:'authored-revocation',compositionMs:0});w.advance(20000);
  const post=w.state.posts.find(p=>w.sourceVisible(p,'org0'));assert.ok(post);
  const owner=actor('org0','commander');
  w.act(owner,{type:'human_work',params:{stage:'relay',reference:needRef(),recipient:'org1'},idempotencyKey:'relay-first'});
  const revoked=w.act(owner,{type:'human_work',params:{stage:'relay',reference:{kind:'post',id:post.public.id,version:post.public.version},recipient:'org1'},idempotencyKey:'relay-revoked'});
  const dependent=work(w,'decide',{kind:'work',id:revoked.id},'dependent-revoked',{dependsOn:[revoked.id]});
  const valid=w.act(owner,{type:'human_work',params:{stage:'relay',reference:needRef(),recipient:'org1'},idempotencyKey:'relay-valid-after'});
  w.inject('post_update',{id:post.public.id,deleted:true});w.advance(23000);
  assert.equal(task(w,revoked.id).state,'inconclusive');assert.equal(task(w,revoked.id).reason,'source_or_permission_changed');
  assert.equal(task(w,dependent.id).state,'inconclusive');assert.equal(task(w,dependent.id).reason,'prerequisite_unconfirmed');
  assert.equal(task(w,valid.id).startedAt,23000);assert.equal(w.actorView('org1').humanInbox.some(x=>x.source.kind==='post'),false);
  w.advance(30000);assert.equal(task(w,valid.id).state,'completed');assert.equal(w.actorView('org1').humanInbox.some(x=>x.source.kind==='post'),false);
  const r=replay(w.checkpoint());assert.equal(r.matches,true);r.world.close();w.close();
});
