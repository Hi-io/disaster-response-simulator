// PREPARED ONLY: this file belongs at tests/facility-role-defaults.test.mjs after RELEASE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { qualifiedStaffAvailable, staffSnapshot } from '../engine/staff.mjs';

const config={policy:'none',hazard:'none',topology:'grid',grid:5,extentKm:2,durationMs:21600000,
  postsPerHour:0,backgroundTraffic:0,healthReports:false,recurringNeeds:false,packetLoss:0,observationRate:1,
  queryLatencyMs:1000,networkLatencyMs:1000,inspectionMs:1000,loadMs:1000,unloadMs:1000,setupMs:1000};
let serial=0;
const act=(w,type,params)=>w.act({id:'facility-role-owner',org:'org0',role:'commander'},
  {type,params,idempotencyKey:'facility-role-'+(++serial)});
const operation=(w,id)=>w.state.operations.find(o=>o.id===id);
const receivedOperation=(w,id)=>w.actorView('org0').known.operations[id];
function until(w,predicate){
  let events=0;while(!predicate()&&events++<30000)assert.ok(w.step(),'Real source events must progress');
  assert.ok(predicate(),'Expected physical effect and independently received evidence must exist');
}
function query(w,target){
  const ack=act(w,'query',{target});until(w,()=>w.state.queries.find(q=>q.id===ack.id)?.state==='ready');
  return w.state.queries.find(q=>q.id===ack.id).result;
}
function receivedSite(w,use){
  const place=query(w,'map').places.find(p=>p.use===use);assert.ok(place,'Select the facility from the received public directory');
  const ack=act(w,'verify',{target:'building',id:place.id,method:'clarification'});
  until(w,()=>w.actorView('org0').inspections.find(i=>i.id===ack.id)?.state==='completed');
  const receipt=w.actorView('org0').inspections.find(i=>i.id===ack.id);
  assert.equal(receipt.result.safe,undefined,'A contact clarification does not certify safety');
  assert.deepEqual(receipt.result.requiredStaffSkills,[use==='plant'?'water_operations':'shelter_support']);
  return receipt.result;
}
function assess(w,site){
  const ack=act(w,'verify',{target:'building',id:site.id,method:'field',purpose:'facility_safety',
    staff:'r-org0-staff',vehicle:'v-org0-1',validForMs:21600000});
  until(w,()=>w.actorView('org0').inspections.find(i=>i.id===ack.id)?.state==='completed');
  const receipt=w.actorView('org0').inspections.find(i=>i.id===ack.id);
  assert.equal(receipt.confirmedBySource,true);assert.equal(receipt.method,'field');assert.equal(receipt.purpose,'facility_safety');
  assert.equal(receipt.result.safe,true);assert.equal(receipt.result.assessment.competent,true);
  assert.ok(receipt.result.assessment.qualifications.includes('field_assessment'));
  assert.deepEqual(receipt.result.requiredStaffSkills,site.requiredStaffSkills);
  assert.deepEqual(w.actorView('org0').known.buildings[site.id].requiredStaffSkills,site.requiredStaffSkills);
  const trip=operation(w,receipt.result.assessment.operation);
  assert.equal(trip.state,'completed');assert.ok(Number.isFinite(trip.times.service));
  assert.ok(w.vehicle('v-org0-1').distanceM>0,'Competence assessment requires actual travel and field work');
  return receipt;
}
function delivery(w,params){
  const ack=act(w,'dispatch',{vehicle:'v-org0-0',ttlMs:3600000,...params});
  until(w,()=>receivedOperation(w,ack.id)?.state==='completed');
  until(w,()=>w.actorView('org0').known.vehicles[ack.vehicle]?.state==='idle');
  const receipt=receivedOperation(w,ack.id);assert.ok(receipt.received>0);assert.ok(Number.isFinite(receipt.times.received));
  return operation(w,ack.id);
}
function provision(w,site,{selectSkills}={}){
  let staffing;
  for(const [type,quantity]of Object.entries(site.dependencies)){
    const params={resource:`r-org0-${type}`,quantity,destination:site.node,building:site.id,
      ...(type==='staff'&&selectSkills?{staffSkills:site.requiredStaffSkills}:{})};
    const op=delivery(w,params);if(type==='staff')staffing=op;
  }
  assert.ok(staffing,'Staff must physically reach the site');return staffing;
}

test('native default plant and shelter reject field-only operational crews after real assessment and physical generic provisioning',t=>{
  for(const [scenario,use]of [['S03','plant'],['S02','shelter']]){
    // This existing native constructor variant supplies the initial profile;
    // no hidden ledger/site/qualification is mutated after observations.
    const w=new World({...config,scenario,compositionVariant:'insufficient_staff',seed:'native-facility-role-negative-'+use});t.after(()=>w.close());
    const site=receivedSite(w,use),inspection=assess(w,site),staff=w.resource('r-org0-staff'),before=staffSnapshot(staff),count=w.state.operations.length;
    assert.deepEqual(inspection.result.assessment.qualifications,['field_assessment']);
    assert.throws(()=>act(w,'dispatch',{resource:staff.id,quantity:site.dependencies.staff,destination:site.node,building:site.id,
      vehicle:'v-org0-0',staffSkills:site.requiredStaffSkills,ttlMs:3600000}),{code:'STAFF_QUALIFICATIONS'});
    assert.deepEqual(staffSnapshot(staff),before);assert.equal(w.state.operations.length,count,'Denied operational selection must not issue a new trip');
    // Passive transport without an operational selector is legal, but cannot
    // turn a field assessor into the required facility operator.
    const arrived=provision(w,site),onsite=w.resource(arrived.destinationStock),building=w.building(site.id);
    assert.deepEqual(arrived.receivedStaff.qualifications,['field_assessment']);
    assert.equal(qualifiedStaffAvailable(onsite,site.requiredStaffSkills),0);assert.ok(onsite.quantity>=site.dependencies.staff);
    for(const [type,quantity]of Object.entries(site.dependencies))assert.ok(building.provisioned[type]>=quantity,'Dependencies must actually arrive before testing operator competence');
    const stockBefore=structuredClone(w.state.resources),commitmentsBefore=structuredClone(w.state.commitments),stateBefore=building.state;
    assert.throws(()=>act(w,'activate',{building:site.id,permit:true}),{code:'QUALIFICATION'});
    assert.deepEqual(w.state.resources,stockBefore);assert.deepEqual(w.state.commitments,commitmentsBefore);
    assert.equal(building.state,stateBefore);assert.equal(building.openAt,undefined);
    assert.equal(w.resource('production-'+site.id),undefined,'Rejected operators never start plant production');
    assert.deepEqual(w.invariants(),[]);
  }
});

test('native standard role requirements travel in received assessments and selected crew receipts before useful plant water or shelter admission',t=>{
  for(const [scenario,use]of [['S03','plant'],['S09','shelter']]){
    const w=new World({...config,scenario,compositionVariant:'standard',seed:'native-facility-role-positive-'+use});t.after(()=>w.close());
    const site=receivedSite(w,use);assess(w,site);
    const staffTrip=provision(w,site,{selectSkills:true}),onsite=w.resource(staffTrip.destinationStock),building=w.building(site.id);
    assert.deepEqual(staffTrip.staffSkills,site.requiredStaffSkills);
    assert.ok(staffTrip.receivedStaff.qualifications.includes(site.requiredStaffSkills[0]));
    assert.equal(qualifiedStaffAvailable(onsite,site.requiredStaffSkills),site.dependencies.staff);
    act(w,'activate',{building:site.id,permit:true});until(w,()=>building.state==='operating');
    assert.equal(qualifiedStaffAvailable(onsite,site.requiredStaffSkills),0,'Assigned operators cannot be allocated to another job');
    assert.equal(onsite.reserved,site.dependencies.staff);
    if(use==='plant'){
      until(w,()=>Object.values(w.actorView('org0').known.resources).some(r=>r.type==='water'&&r.node===site.node&&r.quantity>=100));
      const produced=Object.values(w.actorView('org0').known.resources).find(r=>r.type==='water'&&r.node===site.node&&r.quantity>=100),
        demand=w.actorView('org0').known.needs['need-water-main'];assert.ok(demand);
      assert.equal(produced.id,'production-'+site.id);assert.ok(w.resource('raw-'+site.id).consumed>0);assert.ok(w.resource(produced.id).produced>0);
      const aid=delivery(w,{resource:produced.id,need:demand.id,quantity:100});
      assert.equal(aid.resource,produced.id);assert.equal(aid.received,100);assert.ok(aid.times.service>=building.openAt);
      assert.equal(w.need(demand.id).served,100,'Activation alone is not aid; produced water must physically serve a current need');
    }else{
      const pickup=query(w,'map').places.find(p=>p.id==='b2');assert.ok(pickup,'The S09 demand fixture location must exist in received geography');
      const contact=act(w,'verify',{target:'building',id:pickup.id,method:'clarification'});
      until(w,()=>w.actorView('org0').inspections.find(i=>i.id===contact.id)?.state==='completed');
      until(w,()=>Object.values(w.actorView('org0').known.needs).some(n=>n.building===pickup.id&&n.type==='shelter'));
      const demand=Object.values(w.actorView('org0').known.needs).find(n=>n.building===pickup.id&&n.type==='shelter');
      const task=act(w,'evacuate',{from:demand.building,to:site.id,vehicle:'v-org0-1',quantity:10});
      until(w,()=>receivedOperation(w,task.operation)?.state==='completed');
      const admitted=receivedOperation(w,task.operation);
      assert.equal(admitted.received,10);assert.ok(admitted.times.service>=building.openAt);assert.equal(building.occupancy,10);
      assert.equal(w.need(demand.id).served,10,'Opening without an actual receiving passenger receipt is not useful shelter service');
    }
    assert.deepEqual(w.invariants(),[]);
  }
});
