import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { replay } from '../evaluation/runs.mjs';
import { staffSnapshot } from '../engine/staff.mjs';
import { staffWindow } from '../engine/staff-calendar.mjs';

const config={scenario:'S09',compositionVariant:'delayed',policy:'none',hazard:'none',topology:'grid',grid:5,extentKm:2,
  seed:'physical-staff-duty',durationMs:21600000,postsPerHour:0,backgroundTraffic:0,packetLoss:0,
  healthReports:false,recurringNeeds:false,loadMs:1000,unloadMs:1000,networkLatencyMs:1000,
  inspectionMs:1000,setupMs:1000,waterMlPerPersonDay:100};
let key=0;
const act=(w,org,type,params)=>w.act({id:`duty-owner-${org}`,org,role:'commander'},
  {type,params,idempotencyKey:'duty-'+(++key)});
const change=(w,r,calendar)=>{w.inject('lab_intervention',{kind:'staff_calendar',resource:r.id,calendar});w.advance(w.now);};
const op=(w,id)=>w.state.operations.find(x=>x.id===id);
function until(w,p){let n=0;while(!p()&&n++<30000)assert.ok(w.step(),'Physical work must progress');assert.ok(p());}
function finish(w){w.advance(w.now);assert.deepEqual(w.invariants(),[]);const r=replay(w.checkpoint());
  assert.ok(r.matches,'Source interventions and duty transitions must replay');r.world.close();w.close();}
function delivery(w,org,params){const ack=act(w,org,'dispatch',{vehicle:`v-${org}-0`,ttlMs:3600000,...params});
  until(w,()=>op(w,ack.id).state==='completed');until(w,()=>w.actorView(org).known.vehicles[ack.vehicle]?.state==='idle');return op(w,ack.id);}
function transfer(w,from,to,r,quantity){const t=act(w,from,'transfer',{resource:r.id,to,quantity,ttlMs:3600000});
  act(w,to,'transfer',{action:'accept',id:t.id});const o=delivery(w,from,{transfer:t.id});
  until(w,()=>w.actorView(to).known.resources[o.destinationStock]?.version===w.resource(o.destinationStock).version);
  return w.resource(o.destinationStock);}
function assess(w,b){const i=act(w,'org0','verify',{target:'building',id:b.id,method:'field',purpose:'facility_safety',vehicle:'v-org0-1'});
  until(w,()=>w.actorView('org0').inspections.find(x=>x.id===i.id)?.state==='completed');return i;}

test('off-duty staff cannot inspect and a new received shift enables real work without replenishing people',()=>{
  const w=new World(config),r=w.resource('r-org0-staff');
  change(w,r,{shiftMs:60000,restMs:60000,epochAt:0});const version=r.version,calVersion=r.staffCalendar.version;
  w.setStaffCalendar(r,{shiftMs:60000,restMs:60000,epochAt:0});assert.equal(r.version,version);
  assert.equal(r.staffCalendar.version,calVersion);w.advance(65000);
  const received=w.actorView('org0').known.resources[r.id];assert.deepEqual(received.staffCalendar,r.staffCalendar);
  assert.equal(received.staffCalendar.staffIdentities,undefined);assert.equal(staffWindow(r,w.now).usable,false);
  const ack=act(w,'org0','verify',{target:'resource',id:'r-org0-water',method:'field',staff:r.id,vehicle:'v-org0-1'});
  until(w,()=>w.actorView('org0').inspections.find(i=>i.id===ack.id)?.state==='inconclusive');
  assert.equal(r.reserved,0);assert.equal(w.vehicle('v-org0-1').distanceM??0,0);
  assert.equal(w.state.inspections.find(i=>i.id===ack.id).failure,'staff_unavailable');
  w.advance(120000);const query=act(w,'org0','query',{target:'inventory'});
  until(w,()=>w.state.queries.find(q=>q.id===query.id).state==='ready');
  const next=act(w,'org0','verify',{target:'resource',id:'r-org0-water',method:'field',staff:r.id,vehicle:'v-org0-1'});
  until(w,()=>w.actorView('org0').inspections.find(i=>i.id===next.id)?.state==='completed');
  assert.equal(r.quantity,6);assert.equal(r.reserved,0);assert.equal(w.vehicle('v-org0-1').distanceM??0,0);
  assert.equal(staffWindow({...r,staffCalendar:{shiftMs:1000,restMs:0,epochAt:0}},9000,12000).usable,true,
    'A zero-rest declaration is continuous, not an invented daily interruption');finish(w);
});

test('actual inspection work that crosses a revised shift is inconclusive with travel retained and reservations released',()=>{
  const w=new World({...config,inspectionMs:30000}),b=w.building(w.state.map.shelterId),r=w.resource('r-org0-staff');
  const ack=act(w,'org0','verify',{target:'building',id:b.id,method:'field',purpose:'facility_safety',staff:r.id,vehicle:'v-org0-1'});
  until(w,()=>w.state.inspections.find(i=>i.id===ack.id).state==='inspecting');
  const i=w.state.inspections.find(i=>i.id===ack.id),distance=w.vehicle('v-org0-1').distanceM;
  assert.ok(distance>0);assert.equal(r.reserved,1);
  change(w,r,{shiftMs:w.now+10000,restMs:60000,epochAt:0});
  until(w,()=>w.actorView('org0').inspections.find(x=>x.id===ack.id)?.state==='inconclusive');
  assert.equal(i.failure,'staff_unavailable');assert.equal(i.result??null,null);assert.equal(b.assessed,false);
  assert.equal(r.quantity,6);assert.equal(r.reserved,0);assert.equal(w.vehicle('v-org0-1').distanceM,distance);
  assert.equal(op(w,i.operation).state,'failed');assert.throws(()=>act(w,'org0','activate',{building:b.id,permit:true}),{code:'ASSESSMENT'});
  finish(w);
});

test('different personnel schedules remain separate after real transfers and cancellation returns the exact schedule',()=>{
  const w=new World(config),a=w.resource('r-org0-staff'),b=w.resource('r-org2-staff');
  change(w,b,{shiftMs:7200000,restMs:60000,epochAt:0});
  const first=transfer(w,'org0','org1',a,2),second=transfer(w,'org2','org1',b,2);
  assert.notEqual(first.id,second.id);assert.deepEqual(first.staffCalendar,a.staffCalendar);
  assert.deepEqual(second.staffCalendar,b.staffCalendar);assert.equal(first.quantity,2);assert.equal(second.quantity,2);
  const receivedVersion=second.version;w.setStaffCalendar(second,{shiftMs:b.staffCalendar.shiftMs,restMs:b.staffCalendar.restMs,epochAt:b.staffCalendar.epochAt});
  assert.equal(second.version,receivedVersion,'Re-declaring the same received physical schedule is not a material revision');
  const receivedOp=w.state.operations.find(o=>o.destinationStock===second.id),hash=w.stateHash();
  w.handlers.get('unload')({operation:receivedOp.id});assert.equal(w.stateHash(),hash,
    'A duplicate unload cannot create a calendar version, stock, extra shift event or receipt');
  const ack=act(w,'org1','dispatch',{vehicle:'v-org1-0',resource:second.id,destination:w.organization('org3').node,quantity:1,ttlMs:3600000});
  until(w,()=>w.vehicle(ack.vehicle).load===1&&op(w,ack.id).phase!=='pickup');
  assert.deepEqual(w.vehicle(ack.vehicle).staffCalendar,second.staffCalendar);
  act(w,'org1','cancel',{id:ack.id});until(w,()=>op(w,ack.id).state==='cancelled'&&op(w,ack.id).times.returned!==undefined);
  assert.equal(second.quantity,2);assert.deepEqual(second.staffCalendar,b.staffCalendar);assert.equal(first.quantity,2);
  assert.equal(w.vehicle(ack.vehicle).staffCalendar,undefined);
  for(const skill of ['field_assessment','shelter_support','water_operations']){
    assert.equal(staffSnapshot(a).qualificationCounts[skill]+staffSnapshot(first).qualificationCounts[skill],6);
    assert.equal(staffSnapshot(b).qualificationCounts[skill]+staffSnapshot(second).qualificationCounts[skill],6);}
  const purchase=act(w,'org1','purchase',{type:'staff',quantity:1,price:1,leadMs:60000});
  until(w,()=>w.state.purchases.find(p=>p.id===purchase.id).state==='received');
  const newStock=w.resource(w.state.purchases.find(p=>p.id===purchase.id).receipts[0].resource);
  assert.equal(newStock.staffCalendar,undefined);assert.deepEqual(staffSnapshot(newStock).qualificationCounts,{});finish(w);
});

test('an operating shelter closes on crew rest, retains prior help and occupancy, then requires a new assessment to reopen',()=>{
  const w=new World(config),b=w.building(w.state.map.shelterId);assess(w,b);
  for(const [type,quantity]of Object.entries(b.dependencies)){
    let remaining=quantity;while(remaining){const q=Math.min(remaining,w.vehicle('v-org0-0').capacity);
      delivery(w,'org0',{resource:`r-org0-${type}`,building:b.id,destination:b.node,quantity:q});remaining-=q;}}
  act(w,'org0','activate',{building:b.id,permit:true});until(w,()=>b.state==='operating');
  const demand=w.need('need-case-2'),evac=act(w,'org0','evacuate',{from:demand.building,to:b.id,vehicle:'v-org0-1',quantity:20});
  until(w,()=>op(w,evac.operation).state==='completed');assert.equal(b.occupancy,20);
  const assignment=b.activeReservations.map(id=>w.state.commitments.find(c=>c.id===id)).find(c=>w.resource(c.resource).type==='staff'),r=w.resource(assignment.resource);
  const end=w.now+120000;change(w,r,{shiftMs:end,restMs:120000,epochAt:0});
  const stock=w.resource(`stock-${b.node}-water`),people=r.quantity;
  w.advance(end-1);assert.equal(b.state,'operating');const consumed=stock.consumed,placeMs=b.servedPlaceMs??0;
  w.advance(end);assert.equal(b.state,'closed');assert.equal(b.occupancy,20);assert.equal(r.reserved,0);assert.equal(r.quantity,people);
  assert.ok(stock.consumed>=consumed);assert.ok((b.servedPlaceMs??0)>=placeMs);
  assert.ok(w.log.some(e=>e.type==='facility_closed'&&e.data?.reason==='staff_unavailable'));
  until(w,()=>w.actorView('org0').known.buildings[b.id]?.state==='closed');
  assert.throws(()=>act(w,'org0','activate',{building:b.id,permit:true}),{code:'ASSESSMENT'});
  w.advance(end+120000);assess(w,b);act(w,'org0','activate',{building:b.id,permit:true});until(w,()=>b.state==='operating');
  assert.equal(b.occupancy,20);assert.equal(r.quantity,people);assert.ok(stock.consumed>=consumed);finish(w);
});
