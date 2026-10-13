import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay } from '../evaluation/runs.mjs';
const config={scenario:'S01',policy:'none',hazard:'none',topology:'grid',grid:5,extentKm:2,
  seed:'existing-calendar',durationMs:3600000,postsPerHour:0,backgroundTraffic:0,packetLoss:0,
  healthReports:false,recurringNeeds:false,loadMs:1000,unloadMs:1000,networkLatencyMs:1000};
let serial=0;
const act=(w,org,type,params)=>w.act({id:'calendar-owner-'+org,org,role:'commander'},
  {type,params,idempotencyKey:'calendar-'+(++serial)});
function until(w,p){let n=0;while(!p()&&n++<30000)assert.ok(w.step());assert.ok(p());}
const op=(w,id)=>w.state.operations.find(x=>x.id===id);
const calendar=(w,v,input)=>w.inject('lab_intervention',{kind:'vehicle_calendar',vehicle:v.id,calendar:input});
const finish=w=>{w.advance(w.now);assert.deepEqual(w.invariants(),[]);const r=replay(w.checkpoint());assert.equal(r.matches,true);r.world.close();w.close();};
const dispatch=(w,org)=>act(w,org,'dispatch',{vehicle:`v-${org}-0`,resource:`r-${org}-water`,need:'need-water-main',quantity:300,ttlMs:900000});

test('S01 uses two real 300L deliveries after an existing empty return, and returns the same truck before its next commitment',()=>{
  const w=new World(config),v=w.vehicle('v-org1-0'),r=w.resource('r-org1-water'),initial=r.quantity;
  const declared=w.actorView('org1').known.vehicles[v.id].calendar;
  assert.equal(declared.plannedReturn.cargo,0);assert.equal(declared.plannedReturn.departureAt,600000);
  assert.equal(declared.observedAt,0);assert.deepEqual(w.vehicleView(v).calendar,declared,'reading does not mint calendar versions');
  assert.throws(()=>dispatch(w,'org1'),{code:'VEHICLE_CALENDAR'});assert.equal(r.reserved,0);
  const first=dispatch(w,'org0');until(w,()=>op(w,first.id).state==='completed');
  assert.equal(w.need('need-water-main').served,300);
  w.advance(600000);assert.equal(v.state,'en_route');assert.equal(v.load,0);assert.equal(v.calendar.plannedReturn,undefined);
  until(w,()=>v.state==='idle');assert.equal(v.node,w.organization('org1').node);
  const afterReturnVersion=v.calendar.version,second=dispatch(w,'org1');
  until(w,()=>op(w,second.id).state==='completed');assert.equal(op(w,second.id).received,300);
  assert.equal(w.need('need-water-main').served,600);assert.equal(r.quantity,initial-300);
  assert.equal(v.state,'en_route','completed aid does not teleport the truck back to its appointment');
  until(w,()=>v.state==='idle');assert.equal(v.node,v.calendar.nextCommitment.node);
  assert.ok(v.calendar.version>afterReturnVersion);assert.ok(w.now<v.calendar.nextCommitment.startsAt);
  assert.ok(v.distanceM>0);assert.ok(v.fuelUsed>0);finish(w);
});

test('a tight next appointment or declared availability/fuel window rejects an aid mission atomically',()=>{
  const w=new World(config),v=w.vehicle('v-org0-0'),r=w.resource('r-org0-water');
  for(const input of [{availableUntil:1000},{nextCommitment:{id:'scheduled-job',startsAt:1000,node:v.node}},{availableAfter:600000}]){
    calendar(w,v,input);w.advance(w.now);const qty=r.quantity,reserved=r.reserved,count=w.state.operations.length;
    assert.throws(()=>dispatch(w,'org0'),{code:'VEHICLE_CALENDAR'});
    assert.equal(r.quantity,qty);assert.equal(r.reserved,reserved);assert.equal(w.state.operations.length,count);
  }
  calendar(w,v,{availableUntil:3500000,nextCommitment:{id:'job',startsAt:3500000,node:v.node}});w.advance(w.now);
  const result=w.vehicleMissionCalendar(v,{resource:r,quantity:300,destination:w.building(w.state.map.shelterId).node});
  assert.ok(result.feasible);assert.ok(result.fuelNeeded>0);
  finish(w);
});

test('an outage-delayed command rechecks the same window and communicates failure without consuming stock',()=>{
  const w=new World(config),v=w.vehicle('v-org0-0'),r=w.resource('r-org0-water'),stock=r.quantity;
  calendar(w,v,{availableUntil:1200000,nextCommitment:{id:'appointment',startsAt:1200000,node:v.node}});w.advance(0);
  const trip=dispatch(w,'org0');w.inject('intervention',{type:'cut',sector:w.sectorForNode(v.node),duration:1300000});
  w.advance(1400000);assert.equal(op(w,trip.id).state,'failed');assert.match(op(w,trip.id).failure,/vehicle_calendar/);
  assert.equal(r.quantity,stock);assert.equal(r.reserved,0);assert.equal(v.load,0);
  until(w,()=>w.actorView('org0').operations.some(o=>o.id===trip.id&&o.state==='failed'));
  assert.equal(w.actorView('org0').operations.find(o=>o.id===trip.id).received,0);finish(w);
});

test('a calendar revision during preparation is received normally and loading cannot consume reserved stock afterward',()=>{
  const w=new World({...config,loadMs:30000}),v=w.vehicle('v-org0-0'),r=w.resource('r-org0-water'),stock=r.quantity;
  calendar(w,v,{availableUntil:3500000});w.advance(0);const trip=dispatch(w,'org0');w.advance(5000);
  const oldVersion=v.calendar.version;
  calendar(w,v,{availableUntil:10000});w.advance(50000);
  assert.equal(v.calendar.version,oldVersion+1);assert.equal(op(w,trip.id).state,'failed');
  assert.equal(r.quantity,stock);assert.equal(r.reserved,0);assert.equal(w.need('need-water-main').served,0);finish(w);
});

test('calendar schedules are own/consented knowledge, never unknown future hazards or instant foreign inventory',()=>{
  const w=new World(config),v=w.vehicle('v-org1-0'),own=w.actorView('org1').known.vehicles[v.id];
  assert.ok(own.calendar);assert.equal(w.actorView('org0').known.vehicles[v.id],undefined);
  w.organization('org1').sharing='private';
  const q=act(w,'org0','query',{target:'vehicles'});until(w,()=>w.state.queries.find(x=>x.id===q.id).state==='ready');
  assert.equal(w.state.queries.find(x=>x.id===q.id).result.find(x=>x.id===v.id),undefined);
  assert.equal(own.calendar.predictedHazards,undefined);
  assert.throws(()=>calendar(w,v,{predictedHazards:[]}),{code:'VEHICLE_CALENDAR'});
  assert.equal(v.calendar.version,1);w.close();
});

test('inspection, repair and evacuation cannot bypass an existing appointment or consume crews/places on rejection',()=>{
  const w=new World({...config,scenario:'S23'}),v=w.vehicle('v-org0-0'),staff=w.resource('r-org0-staff'),
    from=w.building('b0'),to=w.building(w.state.map.shelterId);
  to.state='operating';to.damage=0;to.capacity=100;
  const need=w.addNeed({id:'calendar-evac',building:from.id,type:'shelter',quantity:10,unit:'place',population:10});
  calendar(w,v,{availableUntil:1000});w.advance(0);
  const count=w.state.operations.length,held=staff.reserved,places=to.reservedPlaces??0;
  assert.throws(()=>act(w,'org0','verify',{target:'building',id:to.id,vehicle:v.id,method:'field'}),{code:'VEHICLE_CALENDAR'});
  assert.throws(()=>act(w,'org0','repair',{edge:w.state.map.edges[0].id,engineering:true}),{code:'VEHICLE_CALENDAR'});
  assert.throws(()=>act(w,'org0','evacuate',{from:from.id,to:to.id,vehicle:v.id,quantity:10}),{code:'VEHICLE_CALENDAR'});
  assert.equal(w.state.operations.length,count);assert.equal(staff.reserved,held);
  assert.equal(to.reservedPlaces??0,places);assert.equal(need.inTransit??0,0);
  assert.deepEqual(w.invariants(),[]);w.close();
});

test('a queued physical assessment rechecks revised calendar before travel and preserves a truthful inconclusive receipt',()=>{
  const w=new World({...config,scenario:'S23'}),v=w.vehicle('v-org0-0'),staff=w.resource('r-org0-staff');
  calendar(w,v,{availableUntil:3500000});w.advance(0);
  const i=act(w,'org0','verify',{target:'building',id:w.state.map.shelterId,vehicle:v.id,method:'field'});
  // Both are observer-recorded inputs before the queued field_prepare event.
  calendar(w,v,{availableUntil:1000});w.advance(20000);
  const current=w.state.inspections.find(x=>x.id===i.id);
  assert.equal(current.state,'inconclusive');assert.equal(current.result,null);
  assert.equal(staff.reserved,0);assert.equal(v.distanceM??0,0);assert.equal(v.state,'idle');
  assert.ok(w.state.operations.some(op=>op.type==='inspection'&&op.state==='failed'&&op.failure.includes('calendar')));
  finish(w);
});

test('same-GPS calendar revisions cannot be regressed by delayed vehicle queries or telemetry',()=>{
  const w=new World({...config,scenario:'S23'}),v=w.vehicle('v-org0-0');
  calendar(w,v,{availableUntil:3500000});w.advance(5000);
  const q=act(w,'org0','query',{target:'vehicles'});until(w,()=>w.state.queries.find(x=>x.id===q.id).state==='ready');
  const old=structuredClone(w.state.queries.find(x=>x.id===q.id).result),oldView=old.find(x=>x.id===v.id),material=v.version;
  calendar(w,v,{availableUntil:3000000});w.advance(w.now+5000);
  assert.ok(v.version>material);const newest=structuredClone(w.actorView('org0').known.vehicles[v.id]);
  assert.equal(newest.calendar.version,2);assert.equal(newest.calendar.observedAt,v.calendar.observedAt);
  w.completeQuery({id:q.id,result:old,observedAt:w.now+1000});
  assert.deepEqual(w.actorView('org0').known.vehicles[v.id],newest,'later query completion cannot regress a declaration');
  w.send({kind:'telemetry',vehicle:v.id,node:oldView.node,observedAt:w.now+1,
    view:{...oldView,at:w.now+1}},v.owner,{target:v.id,sector:w.sectorForNode(v.node)});
  w.advance(w.now+5000);assert.deepEqual(w.actorView('org0').known.vehicles[v.id],newest);
  assert.deepEqual(w.invariants(),[]);w.close();
});

function remotePickup(w){
  const v=w.vehicle('v-org0-0'),base=v.node,b=w.building('b24'),need=w.need('need-water-main');
  assert.notEqual(b.node,base);assert.notEqual(b.node,w.building(need.building).node);
  calendar(w,v,{availableUntil:3500000,nextCommitment:{id:'after-provision',startsAt:3500000,node:base}});w.advance(w.now);
  const provision=act(w,'org0','dispatch',{vehicle:v.id,resource:'r-org0-water',building:b.id,
    destination:b.node,quantity:100,ttlMs:900000});
  until(w,()=>op(w,provision.id).state==='completed');const r=w.resource(op(w,provision.id).destinationStock);
  assert.equal(r.quantity,100);until(w,()=>v.state==='idle');assert.equal(v.node,base);
  const delivery=act(w,'org0','dispatch',{vehicle:v.id,resource:r.id,need:need.id,quantity:100,ttlMs:900000});
  until(w,()=>op(w,delivery.id).phase==='pickup'&&v.edge);
  return {v,r,delivery:op(w,delivery.id),aid:w.building(need.building).node};
}

test('a physical remote pickup reroute keeps source and aid destinations distinct, then delivers exactly the loaded stock',()=>{
  const w=new World({...config,scenario:'S23'}),{v,r,delivery,aid}=remotePickup(w),need=delivery.need;
  assert.throws(()=>act(w,'org0','reroute',{vehicle:v.id,destination:aid}),{code:'DESTINATION'});
  assert.equal(v.load,0);assert.equal(r.quantity,100);assert.equal(delivery.destination,aid);
  const accepted=act(w,'org0','reroute',{vehicle:v.id,destination:r.node});
  until(w,()=>v.receivedOrderVersion===accepted.orderVersion);
  assert.equal(delivery.destination,aid);assert.equal(delivery.need,need);
  until(w,()=>delivery.state==='completed');assert.equal(delivery.received,100);
  assert.equal(w.need(need).served,100);assert.equal(r.quantity,0);assert.equal(r.transferred,100);
  assert.ok(delivery.times.pickupArrived<delivery.times.prepared);
  finish(w);
});

test('loading away from the stock fails without teleporting cargo and a delayed pickup reroute cannot overwrite a later aid leg',()=>{
  const w=new World({...config,scenario:'S23'}),{v,r,delivery,aid}=remotePickup(w);
  // Deliberately invoke the internal event early: the defensive source guard
  // must reject impossible loading even if a lifecycle callback is corrupted.
  w.handlers.get('load')({operation:delivery.id});w.advance(w.now);
  assert.equal(delivery.state,'failed');assert.equal(delivery.failure,'pickup_wrong_location');
  assert.equal(r.quantity,100);assert.equal(r.reserved,0);assert.equal(v.load,0);
  assert.equal(w.need(delivery.need).served,0);assert.ok(v.edge,'failure does not teleport the travelling truck');
  until(w,()=>v.state==='idle');assert.notEqual(v.node,r.node);
  until(w,()=>w.actorView('org0').operations.some(o=>o.id===delivery.id&&o.state==='failed'));
  assert.deepEqual(w.invariants(),[]);w.close();
  const second=new World({...config,scenario:'S23'}),p=remotePickup(second);
  until(second,()=>p.delivery.times.prepared!==undefined);const received=p.v.receivedOrderVersion??0;
  second.applyReroute(p.v,{kind:'reroute',vehicle:p.v.id,destination:p.r.node,pickup:true,orderVersion:received+1});
  assert.equal(p.delivery.destination,p.aid);assert.equal(p.v.receivedOrderVersion??0,received);
  until(second,()=>p.delivery.state==='completed');assert.equal(p.delivery.received,100);
  assert.deepEqual(second.invariants(),[]);second.close();
});

test('reroute instructions cannot bypass revised calendar and preserve loaded cargo when a late order is rejected',()=>{
  const w=new World({...config,scenario:'S23'}),v=w.vehicle('v-org0-0');
  calendar(w,v,{availableUntil:3500000});w.advance(0);const result=dispatch(w,'org0'),delivery=op(w,result.id);
  until(w,()=>v.load===300&&v.edge);const destination=delivery.destination;
  const request=act(w,'org0','reroute',{vehicle:v.id,destination});
  calendar(w,v,{availableUntil:w.now+1});w.advance(w.now+10000);
  assert.equal(v.order.version,request.orderVersion);assert.match(v.order.reason,/vehicle_calendar/);
  assert.equal(delivery.destination,destination);assert.equal(v.load,300);assert.equal(delivery.received,0);
  assert.throws(()=>act(w,'org0','reroute',{vehicle:v.id,destination}),{code:'VEHICLE_CALENDAR'});
  until(w,()=>delivery.state==='completed');assert.equal(delivery.received,300);finish(w);
});
