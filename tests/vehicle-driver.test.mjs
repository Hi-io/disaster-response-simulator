import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay } from '../evaluation/runs.mjs';
const config={scenario:'S23',policy:'none',hazard:'none',topology:'grid',grid:5,extentKm:2,
  seed:'driver-received',durationMs:3600000,postsPerHour:0,backgroundTraffic:0,packetLoss:0,
  healthReports:false,recurringNeeds:false,loadMs:30000,unloadMs:1000,networkLatencyMs:1000};
let k=0;
const act=(w,type,params)=>w.act({id:'driver-owner',org:'org0',role:'commander'},
  {type,params,idempotencyKey:'driver-'+(++k)});
const driver=(w,v,available)=>w.inject('lab_intervention',{kind:'vehicle_driver',vehicle:v.id,available});
const dispatch=w=>act(w,'dispatch',{vehicle:'v-org0-0',resource:'r-org0-water',need:'need-water-main',quantity:300});
function until(w,p){let i=0;while(!p()&&i++<30000)assert.ok(w.step());assert.ok(p());}
const finish=w=>{w.advance(w.now);assert.deepEqual(w.invariants(),[]);const r=replay(w.checkpoint());assert.ok(r.matches);r.world.close();w.close();};

test('a received absent driver prevents stock reservation, travel, crew assignment and a fake ready vehicle',()=>{
  const w=new World(config),v=w.vehicle('v-org0-0'),r=w.resource('r-org0-water'),stock=r.quantity;
  assert.equal(w.actorView('org0').known.vehicles[v.id].driverAvailable,true);
  driver(w,v,false);w.advance(5000);const received=w.actorView('org0').known.vehicles[v.id];
  assert.equal(received.driverAvailable,false);assert.equal(received.driver,undefined);
  assert.throws(()=>dispatch(w),{code:'VEHICLE_DRIVER'});
  assert.throws(()=>act(w,'verify',{target:'building',id:w.state.map.shelterId,method:'field',vehicle:v.id}),{code:'VEHICLE_DRIVER'});
  assert.equal(r.quantity,stock);assert.equal(r.reserved,0);assert.equal(v.load,0);
  assert.equal(v.distanceM??0,0);assert.equal(w.state.operations.length,0);
  driver(w,v,true);w.advance(w.now+5000);const o=dispatch(w);
  until(w,()=>w.state.operations.find(x=>x.id===o.id).state==='completed');
  assert.equal(w.need('need-water-main').served,300);finish(w);
});

test('driver absence during loading releases the hold and transmits failure through an outage without creating cargo',()=>{
  const w=new World(config),v=w.vehicle('v-org0-0'),r=w.resource('r-org0-water'),stock=r.quantity,ack=dispatch(w);
  w.advance(5000);driver(w,v,false);
  w.inject('intervention',{type:'cut',sector:w.sectorForNode(v.node),duration:90000});
  w.advance(40000);const op=w.state.operations.find(x=>x.id===ack.id);
  assert.equal(op.state,'failed');assert.equal(op.failure,'driver_unavailable');
  assert.equal(r.quantity,stock);assert.equal(r.reserved,0);assert.equal(v.load,0);assert.equal(v.distanceM??0,0);
  assert.notEqual(w.actorView('org0').operations.find(o=>o.id===op.id)?.state,'failed');
  until(w,()=>w.actorView('org0').operations.find(o=>o.id===op.id)?.state==='failed');
  assert.equal(w.actorView('org0').known.vehicles[v.id].driverAvailable,false);finish(w);
});

test('losing the driver while travelling stops at the next real vertex and retains cargo until a new received instruction',()=>{
  const w=new World(config),v=w.vehicle('v-org0-0'),ack=dispatch(w);
  until(w,()=>v.load===300&&v.edge);const edge=v.edge,node=v.node,distance=v.distanceM??0;
  driver(w,v,false);w.advance(w.now);assert.equal(v.edge,edge);assert.equal(v.node,node);
  until(w,()=>v.state==='blocked'&&!v.edge);const op=w.state.operations.find(x=>x.id===ack.id);
  assert.equal(op.state,'blocked');assert.equal(v.load,300);assert.equal(op.received,0);
  assert.equal(w.need(op.need).served,0);assert.ok(v.distanceM>distance);
  assert.throws(()=>act(w,'reroute',{vehicle:v.id,destination:op.destination}),{code:'VEHICLE_DRIVER'});
  driver(w,v,true);w.advance(w.now+5000);act(w,'reroute',{vehicle:v.id,destination:op.destination});
  until(w,()=>op.state==='completed');assert.equal(op.received,300);assert.equal(v.load,0);finish(w);
});
