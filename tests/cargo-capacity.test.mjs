import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { cargoProfile,grossVehicleWeight } from '../contracts/cargo.mjs';
import { route } from '../generators/map.mjs';
import { replay } from '../evaluation/runs.mjs';

const config={scenario:'S23',seed:'physical-cargo-contract',policy:'none',hazard:'none',
  topology:'grid',grid:5,extentKm:2,durationMs:21600000,postsPerHour:0,backgroundTraffic:0,
  healthReports:false,recurringNeeds:false,packetLoss:0,networkLatencyMs:1000,
  loadMs:30000,unloadMs:1000,inspectionMs:1000,setupMs:1000};
let serial=0;
const act=(w,type,params,org='org0')=>w.act({id:`cargo-owner-${org}`,org,role:'commander'},
  {type,params,idempotencyKey:'physical-cargo-'+(++serial)});
const op=(w,id)=>w.state.operations.find(o=>o.id===id);
function until(w,p){let n=0;while(!p()&&n++<30000)assert.ok(w.step(),'physical events exhausted');assert.ok(p());}
function clean(w,{exactReplay=true}={}){assert.deepEqual(w.invariants(),[]);w.advance(w.now);
  if(exactReplay){const r=replay(w.checkpoint());assert.equal(r.matches,true);r.world.close();}w.close();}
function buy(w,type,quantity){const p=act(w,'purchase',{type,quantity,price:1,leadMs:60000});
  until(w,()=>w.state.purchases.find(x=>x.id===p.id).state==='received');
  return w.resource(w.state.purchases.find(x=>x.id===p.id).receipts[0].resource);}
const water=w=>act(w,'dispatch',{vehicle:'v-org0-0',resource:'r-org0-water',need:'need-water-main',quantity:300});

test('physically pooled and purchased stock cannot bypass mass, volume, seat or unit limits before reservation',()=>{
  const w=new World(config),v=w.vehicle('v-org0-0'),to=w.organization('org1').node;
  // Relocate the native team to its own depot, then physically receive three
  // independently accepted teams. No fixture changes quantities or skills.
  const home=act(w,'dispatch',{resource:'r-org0-staff',quantity:6,vehicle:v.id,destination:v.node});
  until(w,()=>op(w,home.id).state==='completed');
  until(w,()=>v.state==='idle');
  const staff=w.resource(op(w,home.id).destinationStock);
  for(const org of ['org1','org2','org3']){
    const t=act(w,'transfer',{resource:`r-${org}-staff`,quantity:6,to:'org0',ttlMs:3600000},org);
    act(w,'transfer',{action:'accept',id:t.id});
    const d=act(w,'dispatch',{transfer:t.id,vehicle:`v-${org}-0`},org);
    until(w,()=>op(w,d.id).state==='completed');
  }
  const energy=buy(w,'energy',4);
  assert.equal(staff.quantity,24);assert.equal(energy.quantity,6);
  const counts={operations:w.state.operations.length,commitments:w.state.commitments.length};
  for(const [r,quantity,code] of [[staff,21,'SEATS'],[staff,14,'WEIGHT'],[energy,6,'VOLUME'],[w.resource('r-org0-water'),601,'CAPACITY']]){
    const stock=r.quantity;
    assert.throws(()=>act(w,'dispatch',{resource:r.id,quantity,vehicle:v.id,destination:to}),{code});
    assert.equal(r.quantity,stock);assert.equal(r.reserved,0);assert.equal(v.load,0);assert.equal(v.state,'idle');
  }
  assert.equal(w.state.operations.length,counts.operations);assert.equal(w.state.commitments.length,counts.commitments);
  assert.deepEqual(w.resourceView(staff).transport,cargoProfile('staff'));
  const query=act(w,'query',{target:'policy'});until(w,()=>w.actorView('org0').queries.find(q=>q.id===query.id)?.state==='ready');
  const policy=w.actorView('org0').queries.find(q=>q.id===query.id).result;
  assert.deepEqual(policy.execution.cargo.types.staff,cargoProfile('staff'));clean(w);
});

test('bilaterally approved staff transfer preserves profiles, seats and exact 75kg-per-person cargo on a real trip',()=>{
  const w=new World(config),r=w.resource('r-org0-staff'),stock=r.quantity;
  const t=act(w,'transfer',{resource:r.id,quantity:2,to:'org1',ttlMs:3600000});
  act(w,'transfer',{action:'accept',id:t.id},'org1');
  const d=act(w,'dispatch',{transfer:t.id,vehicle:'v-org0-0'}),v=w.vehicle(d.vehicle);
  until(w,()=>v.load===2&&v.edge);
  assert.equal(v.passengers,0);assert.equal(grossVehicleWeight(v),v.weightKg+150);
  assert.equal(w.vehicleView(v).crewQuantity,0);
  until(w,()=>op(w,d.id).state==='completed');
  const delivered=w.resource(op(w,d.id).destinationStock);
  assert.equal(delivered.owner,'org1');assert.equal(delivered.quantity,2);
  assert.equal(r.quantity,stock-2);assert.equal(v.load,0);assert.deepEqual(delivered.qualifications,r.qualifications);
  assert.equal(op(w,d.id).received,2);assert.ok(v.distanceM>0);clean(w);
});

test('loading rechecks corrected declared vehicle limits, releases real stock and delays failure receipt through an outage',()=>{
  // Component fixture: the declared vehicle limit is changed explicitly between
  // acceptance and loading. This is not an exogenous scenario/replay claim.
  const w=new World(config),v=w.vehicle('v-org0-0'),r=w.resource('r-org0-water'),stock=r.quantity,d=water(w);
  w.advance(5000);assert.equal(r.reserved,300);v.volumeM3=0.1;
  w.inject('intervention',{type:'cut',sector:w.sectorForNode(v.node),duration:90000});
  w.advance(40000);assert.equal(op(w,d.id).state,'failed');assert.equal(op(w,d.id).failure,'cargo:VOLUME');
  assert.equal(v.load,0);assert.equal(r.quantity,stock);assert.equal(r.reserved,0);
  assert.equal(w.need('need-water-main').served,0);
  assert.notEqual(w.actorView('org0').known.operations[d.id]?.state,'failed');
  until(w,()=>w.actorView('org0').known.operations[d.id]?.state==='failed');
  v.volumeM3=1;const retry=water(w);until(w,()=>op(w,retry.id).state==='completed');
  assert.equal(op(w,retry.id).received,300);assert.equal(r.quantity,stock-300);
  assert.equal(w.need('need-water-main').served,300);clean(w,{exactReplay:false});
});

test('a loaded reroute and received instruction recheck cargo without duplication, then recover the same trip',()=>{
  const w=new World(config),v=w.vehicle('v-org0-0'),r=w.resource('r-org0-water'),stock=r.quantity,d=water(w);
  until(w,()=>v.load===300&&v.edge);const trip=op(w,d.id),destination=trip.destination;
  act(w,'reroute',{vehicle:v.id,destination});v.maxCargoKg=100;
  const count=w.state.operations.length;
  assert.throws(()=>act(w,'reroute',{vehicle:v.id,destination}),{code:'WEIGHT'});
  until(w,()=>v.state==='blocked'&&!v.edge);
  assert.equal(v.load,300);assert.equal(trip.destination,destination);assert.equal(trip.state,'blocked');
  assert.equal(w.need(trip.need).served,0);assert.equal(w.state.operations.length,count);
  assert.match(v.order?.reason??'',/cargo:WEIGHT/);
  v.maxCargoKg=1000;act(w,'reroute',{vehicle:v.id,destination});
  until(w,()=>trip.state==='completed');assert.equal(trip.received,300);assert.equal(v.load,0);
  assert.equal(r.quantity,stock-300);assert.equal(w.need(trip.need).served,300);clean(w,{exactReplay:false});
});

test('road gross mass counts cabin passengers and working crew separately from staff freight',()=>{
  const w=new World(config),v=w.vehicle('v-org0-0'),from=v.node,to=w.organization('org1').node;
  // Declared road-capacity component fixture. It tests all possible paths, not
  // an actor-visible prediction of a future disaster.
  for(const e of w.state.map.edges)e.maxWeight=v.weightKg+74;
  assert.ok(route(w.state.map,from,to,v,{}));
  assert.equal(route(w.state.map,from,to,{...v,crewQuantity:1},{}),null);
  assert.equal(route(w.state.map,from,to,{...v,passengers:1},{}),null);
  assert.equal(route(w.state.map,from,to,{...v,resourceType:'staff',load:1},{}),null);
  const r=w.resource('r-org0-staff');
  assert.throws(()=>act(w,'dispatch',{vehicle:v.id,resource:r.id,quantity:1,destination:to}),{code:'ROUTE'});
  assert.equal(r.reserved,0);assert.equal(w.state.operations.length,0);clean(w,{exactReplay:false});
});

test('field work needs real cabin seats without repurposing the freight volume limit as cabin volume',()=>{
  const w=new World(config),v=w.vehicle('v-org0-0'),r=w.resource('r-org0-staff'),b=w.state.map.shelterId;
  v.seats=0;const i=act(w,'verify',{target:'building',id:b,method:'field',vehicle:v.id});
  until(w,()=>w.state.inspections.find(x=>x.id===i.id).state==='inconclusive');
  assert.equal(r.reserved,0);assert.equal(v.distanceM??0,0);
  v.seats=20;v.volumeM3=0.01;
  const next=act(w,'verify',{target:'building',id:b,method:'field',vehicle:v.id});
  until(w,()=>v.crewQuantity===1&&v.edge);assert.equal(grossVehicleWeight(v),v.weightKg+75);
  until(w,()=>w.actorView('org0').inspections.find(x=>x.id===next.id)?.state==='completed');
  assert.equal(r.reserved,0);assert.equal(v.crewQuantity??0,0);clean(w,{exactReplay:false});
});

test('the physically released field crew reaches the received idle vehicle once, without polling version churn',()=>{
  const w=new World(config),v=w.vehicle('v-org0-0'),i=act(w,'verify',{
    target:'building',id:w.state.map.shelterId,method:'field',vehicle:v.id});
  until(w,()=>w.actorView('org0').known.vehicles[v.id]?.crewQuantity===1);
  assert.equal(w.actorView('org0').known.vehicles[v.id].crewQuantity,1);
  until(w,()=>w.actorView('org0').inspections.find(x=>x.id===i.id)?.state==='completed'&&
    w.actorView('org0').known.vehicles[v.id]?.state==='idle'&&w.actorView('org0').known.vehicles[v.id].crewQuantity===0);
  assert.equal(v.crewQuantity,undefined);const received=w.actorView('org0').known.vehicles[v.id],version=received.version;
  for(let n=0;n<20;n++)assert.equal(w.vehicleView(v).crewQuantity,0);
  w.advance(w.now+10000);assert.equal(w.actorView('org0').known.vehicles[v.id].version,version);
  clean(w);
});
