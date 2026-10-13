import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine/world.mjs';
import {replay} from '../evaluation/runs.mjs';
const cfg={scenario:'S14',seed:'actual-unloading-crew',policy:'none',hazard:'none',topology:'grid',grid:5,extentKm:2,
  durationMs:7200000,organizations:3,postsPerHour:0,backgroundTraffic:0,packetLoss:0,healthReports:false,recurringNeeds:false,
  networkLatencyMs:1000,loadMs:1000,unloadMs:2000,inspectionMs:1000,setupMs:1000,reviewMs:1000};
let serial=0;
const act=(w,type,params,org='org0',role='commander')=>w.act({id:`${role}-${org}`,org,role},
  {type,params,idempotencyKey:`unloading-test-${++serial}`});
const op=(w,id)=>w.state.operations.find(o=>o.id===id);
function until(w,p){let count=0;while(!p()&&count++<30000)assert.ok(w.step(),'events exhausted');assert.ok(p());}
function approve(w,params,org='org0'){
  const action={type:'unload',owner:org,params,dependsOn:[]},p=act(w,'propose',{title:'Assign exact onsite crew',plan:{actions:[action]}},org);
  act(w,'review',{id:p.id,decision:'approve'},org);until(w,()=>w.state.proposals.find(x=>x.id===p.id).state==='authorized');
  return {...params,proposal:p.id,step:0};
}
function waitAid(w,{org='org0'}={}){
  const d=act(w,'dispatch',{vehicle:`v-${org}-0`,resource:`r-${org}-water`,need:'need-water-main',quantity:300},org);
  until(w,()=>w.actorView(org).unloadingRequests.some(r=>r.operation===d.id));
  return d;
}
function crew(w){
  const b=w.building(w.state.map.shelterId),d=act(w,'dispatch',{vehicle:'v-org0-1',resource:'r-org0-staff',quantity:1,building:b.id,destination:b.node,staffSkills:['shelter_support']});
  until(w,()=>op(w,d.id).state==='completed');until(w,()=>w.actorView('org0').known.resources[op(w,d.id).destinationStock]);
  return w.resource(op(w,d.id).destinationStock);
}
function terms(w,d,r){const request=w.actorView('org0').unloadingRequests.find(x=>x.operation===d.id);
  return {operation:d.id,staff:r.id,quantity:request.staffQuantity,targetVersion:request.targetVersion,
    requestVersion:request.version,sourceVersion:request.operationVersion,deliveryQuantity:request.deliveryQuantity};}
function finish(w,exact=true){assert.deepEqual(w.invariants(),[]);w.advance(w.now);if(exact){const r=replay(w.checkpoint());assert.equal(r.matches,true);r.world.close();}w.close();}

test('S14 waits at destination, transports actual qualified workers and resumes the same original cargo after independent review',()=>{
  const w=new World(cfg),d=waitAid(w),v=w.vehicle(d.vehicle),stock=w.resource('r-org0-water').quantity;
  w.advance(w.now+60000);assert.equal(op(w,d.id).state,'waiting_to_unload');assert.equal(v.load,300);
  assert.equal(w.need('need-water-main').served,0);assert.equal(op(w,d.id).received??0,0);
  const r=crew(w);assert.equal(r.quantity,1);assert.ok(r.qualifications.includes('shelter_support'));
  const p=terms(w,d,r);assert.throws(()=>act(w,'unload',{...p,proposal:'missing',step:0}),{code:'UNLOADING_APPROVAL'});
  const authorized=approve(w,p);const accepted=act(w,'unload',authorized);
  assert.equal(accepted.state,'queued');assert.equal(accepted.received,0);assert.equal(v.load,300);assert.equal(r.reserved,1);
  until(w,()=>w.actorView('org0').unloadingRequests.find(x=>x.operation===d.id)?.state==='completed');
  const receipt=w.actorView('org0').unloadingRequests.find(x=>x.operation===d.id);
  assert.equal(receipt.received,300);assert.equal(op(w,d.id).received,300);assert.equal(v.load,0);assert.equal(r.reserved,0);
  assert.equal(w.need('need-water-main').served,300);assert.equal(w.resource('r-org0-water').quantity,stock);
  assert.equal(w.state.operations.filter(o=>o.resourceType==='water').length,1);
  assert.ok(receipt.times.received>=receipt.times.workStarted+receipt.workMs);assert.ok(receipt.times.orderReceived>receipt.times.authorized);
  finish(w);
});

test('stale versions, absent receiver authority, foreign and offsite crew cannot mutate the original physical delivery',()=>{
  const w=new World(cfg),d=waitAid(w),r=crew(w),p=terms(w,d,r),a=approve(w,p),before=w.state.operations.length;
  assert.throws(()=>act(w,'unload',{...a,sourceVersion:a.sourceVersion+1}),{code:'VERSION_CONFLICT'});
  assert.throws(()=>act(w,'unload',a,'org1'),{code:'UNLOADING_RECEIPT'});
  assert.throws(()=>act(w,'unload',{...a,staff:'r-org1-staff'}),{code:'UNLOADING_STAFF'});
  assert.throws(()=>act(w,'unload',{...a,staff:'r-org0-staff'}),{code:'UNLOADING_STAFF'});
  assert.equal(r.reserved,0);assert.equal(w.vehicle(d.vehicle).load,300);assert.equal(w.state.operations.length,before);assert.equal(w.need('need-water-main').served,0);
  finish(w);
});

test('a finite crew shift ending during actual unloading yields an inconclusive receipt and retains cargo for a separately reviewed retry',()=>{
  const w=new World(cfg),d=waitAid(w),r=crew(w),b=w.building(w.state.map.shelterId);
  const a=approve(w,terms(w,d,r));act(w,'unload',a);until(w,()=>w.state.unloadingRequests.find(x=>x.operation===d.id).state==='working');
  w.setStaffCalendar(r,{epochAt:w.now,shiftMs:500,restMs:10000});
  until(w,()=>w.actorView('org0').unloadingRequests.find(x=>x.operation===d.id)?.state==='inconclusive');
  assert.equal(r.reserved,0);assert.equal(w.vehicle(d.vehicle).load,300);assert.equal(w.need('need-water-main').served,0);assert.equal(b.unloadingCount,0);
  w.setStaffCalendar(r,{epochAt:w.now,shiftMs:100000,restMs:0});
  const retry=approve(w,terms(w,d,r));act(w,'unload',retry);
  until(w,()=>op(w,d.id).state==='completed');assert.equal(op(w,d.id).received,300);assert.equal(w.need('need-water-main').served,300);
  finish(w,false); // Declared calendar edits are explicit component inputs, not replayed external commands.
});

test('donor and receiver get only authentic delayed unloading receipts and no third organization sees private coordination',()=>{
  const w=new World(cfg),d=waitAid(w,{org:'org1'}),r=crew(w),p=terms(w,d,r);
  assert.equal(w.actorView('org2').unloadingRequests.length,0);
  act(w,'unload',approve(w,p));
  w.organization('org1').connected=false;
  until(w,()=>op(w,d.id).state==='completed');
  assert.equal(w.actorView('org1').unloadingRequests.find(x=>x.operation===d.id).received,0);
  assert.equal(w.actorView('org2').unloadingRequests.length,0);
  w.organization('org1').connected=true;
  until(w,()=>w.actorView('org1').unloadingRequests.find(x=>x.operation===d.id)?.state==='completed');
  const final=w.actorView('org1').unloadingRequests.find(x=>x.operation===d.id);assert.equal(final.received,300);
  w.send({kind:'unloading_request',request:{...final,version:final.version-1,state:'waiting_for_crew',received:0}},'org1',{sector:bSector(w)});
  w.advance(w.now+3000);assert.equal(w.actorView('org1').unloadingRequests.find(x=>x.operation===d.id).state,'completed');
  finish(w,false);
});
const bSector=w=>w.building(w.state.map.shelterId).sector;

test('a receiver approval revoked before the real command arrives releases only its crew and cannot unload donor cargo',()=>{
  const w=new World(cfg),d=waitAid(w),r=crew(w),p=approve(w,terms(w,d,r));act(w,'unload',p);
  act(w,'review',{id:p.proposal,decision:'reject'});
  until(w,()=>w.actorView('org0').unloadingRequests.find(x=>x.operation===d.id)?.state==='inconclusive');
  assert.equal(r.reserved,0);assert.equal(w.vehicle(d.vehicle).load,300);assert.equal(op(w,d.id).received??0,0);
  assert.equal(w.need('need-water-main').served,0);finish(w);
});

test('the competent conventional controller can recover one spare shipment, transport its crew and deliver the entire S14 need',()=>{
  const w=new World({...cfg,policy:'conventional',organizations:2});w.advance(cfg.durationMs);
  assert.equal(w.need('need-water-main').served,600);
  const deliveries=w.state.operations.filter(o=>o.resourceType==='water'&&o.state==='completed');
  assert.equal(deliveries.reduce((n,o)=>n+o.received,0),600);
  const recovered=w.state.operations.find(o=>o.resourceType==='water'&&o.type==='recovery');assert.ok(recovered);
  assert.equal(recovered.received??0,0);assert.ok(w.vehicle(recovered.vehicle).distanceM>0);
  assert.ok(w.state.operations.some(o=>o.resourceType==='staff'&&o.received===1));
  assert.ok(w.state.unloadingRequests.some(r=>r.operation===deliveries[0].id&&r.received===300));
  finish(w);
});

test('unusable onsite crew fails atomically without publishing a prospective assignment or mutating the original delivery',()=>{
  for(const condition of ['damaged','expired','quarantined']){
    const w=new World(cfg),d=waitAid(w),staff=crew(w),params=approve(w,terms(w,d,staff));
    staff.condition=condition;
    const request=w.state.unloadingRequests.find(r=>r.operation===d.id),before=structuredClone(request),
      cargo=w.vehicle(d.vehicle).load,stock=staff.quantity,operations=w.state.operations.length;
    assert.throws(()=>act(w,'unload',params),{code:'UNLOADING_STAFF'});
    assert.deepEqual(request,before);assert.equal(staff.reserved,0);assert.equal(staff.quantity,stock);
    assert.equal(w.vehicle(d.vehicle).load,cargo);assert.equal(w.need('need-water-main').served,0);
    assert.equal(w.state.operations.length,operations);assert.equal(op(w,d.id).state,'waiting_to_unload');
    finish(w,false); // Explicit static condition component, not a scripted external hazard.
  }
});
