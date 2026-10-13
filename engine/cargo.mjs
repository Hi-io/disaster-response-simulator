import { clone } from './determinism.mjs';
import { release } from './ledger.mjs';
import { cargoProfile,cargoViolation,checkVehicleCargo } from '../contracts/cargo.mjs';

const terminal=op=>!op||['completed','failed','cancelled'].includes(op.state);
export function installCargo(w){
  const rv=w.resourceView.bind(w);w.resourceView=r=>({...rv(r),transport:clone(cargoProfile(r.type))});
  const vv=w.vehicleView.bind(w);w.vehicleView=v=>({...vv(v),crewQuantity:v.crewQuantity??0});
  const crewFor=op=>{const t=op?.type==='inspection'?w.state.inspections.find(i=>i.operation===op.id):
    op?.type==='repair'?w.state.repairs?.find(t=>t.operation===op.id):null;
    const c=w.state.commitments.find(c=>c.id===t?.staff&&c.state==='confirmed');return c?.quantity??0;};
  const clearCrew=v=>{if(v?.crewQuantity&&!w.state.operations.some(o=>o.id===v.operation&&!terminal(o)&&['inspection','repair'].includes(o.type))){
    delete v.crewQuantity;w.reportVehicle(v);}};
  const fail=(v,op,e)=>{
    if(terminal(op))return false;op.failure=`cargo:${e.code}`;
    if(v.load||v.passengers){op.state='blocked';v.state='blocked';}
    else{
      op.state='failed';op.times.failed=w.now;
      const c=w.state.commitments.find(c=>c.id===op.commitment);
      if(c&&['reserved','confirmed'].includes(c.state)){const r=w.resource(c.resource);
        release(r,c.quantity,c.staffReservation);c.state='released';c.version++;w.reportResource(r,r.owner);}
      const i=w.state.inspections.find(i=>i.operation===op.id),r=w.state.repairs?.find(r=>r.operation===op.id),
        t=w.state.transfers?.find(t=>t.id===op.transfer),ev=w.state.evacuations?.find(t=>t.operation===op.id);
      if(i){w.releaseStaff(i.staff);i.state='inconclusive';i.failure=op.failure;
        w.send({kind:'verification',inspection:i.id,result:null,observedAt:w.now},i.org,{sector:w.sectorForNode(v.node)});
        if(i.reportTo&&i.reportTo!==i.org)w.send({kind:'verification',inspection:i.id,result:null,
          observedAt:w.now,recipient:i.reportTo},i.reportTo,{sector:w.sectorForNode(v.node)});}
      if(r){w.releaseStaff(r.staff);r.state='failed';r.failure=op.failure;}
      if(t){t.state='failed';t.failure=op.failure;}
      if(ev&&!['failed','completed'].includes(ev.state)){ev.state='failed';ev.failure=op.failure;
        w.need(ev.need).inTransit-=ev.quantity;w.building(ev.to).reservedPlaces-=ev.quantity;}
      v.operation=null;if(v.edge)v.pendingCancel=true;else v.state='idle';delete v.crewQuantity;
    }
    w.reportOperation(op);w.reportVehicle(v);w.record('cargo_limit_failed',{vehicle:v.id,reason:e.code},op.id);return false;
  };
  const planned=(v,op)=>cargoViolation(v,op.resourceType??'staff',
    op.resource?op.quantity:0,{passengers:op.type==='evacuation'?w.state.evacuations.find(t=>t.operation===op.id)?.quantity??0:v.passengers??0,
      crew:crewFor(op)});
  const load=w.handlers.get('load');w.on('load',p=>{const op=w.state.operations.find(o=>o.id===p.operation),v=w.vehicle(op?.vehicle);
    if(terminal(op))return;const e=planned(v,op);if(e){fail(v,op,e);return;}load(p);});
  const evacLoad=w.handlers.get('evacuation_load');w.on('evacuation_load',p=>{const op=w.state.operations.find(o=>o.id===p.operation),v=w.vehicle(op?.vehicle);
    if(terminal(op))return;const e=planned(v,op);if(e){fail(v,op,e);return;}evacLoad(p);});
  const trip=w.startTrip;w.startTrip=(v,destination,op=null)=>{
    clearCrew(v);const crew=crewFor(op);if(crew)v.crewQuantity=crew;
    const e=op?planned(v,op):cargoViolation(v,v.resourceType??'staff',v.load??0);
    if(e&&op)return fail(v,op,e);return trip(v,destination,op);
  };
  const enter=w.handlers.get('vehicle_enter');w.on('vehicle_enter',p=>{const v=w.vehicle(p.vehicle),op=w.state.operations.find(o=>o.id===v?.operation);
    if(v&&!v.edge&&!['idle','arrived','failed','cancelled'].includes(v.state)){
      const e=cargoViolation(v,v.resourceType??'staff',v.load??0);if(e&&op){fail(v,op,e);return;}}
    enter(p);clearCrew(v);});
  const reroute=w.actionHandlers.get('reroute');w.onAction('reroute',(a,p,req)=>{const v=w.vehicle(p.vehicle),op=w.state.operations.find(o=>o.id===v?.operation);
    if(v?.owner===a.org&&op){const e=op.phase==='pickup'?planned(v,op):cargoViolation(v,v.resourceType??'staff',v.load??0);
      if(e)checkVehicleCargo(v,op.phase==='pickup'?op.resourceType??'staff':v.resourceType??'staff',op.phase==='pickup'?op.quantity??0:v.load??0,
        {passengers:op.type==='evacuation'?w.state.evacuations.find(t=>t.operation===op.id)?.quantity??0:v.passengers??0,crew:crewFor(op)});}
    return reroute(a,p,req);});
  const apply=w.applyReroute;w.applyReroute=(v,p)=>{const op=w.state.operations.find(o=>o.id===v.operation);if(!terminal(op)){
    const e=op.phase==='pickup'?planned(v,op):cargoViolation(v,v.resourceType??'staff',v.load??0);
    if(e){v.receivedOrderVersion=Math.max(v.receivedOrderVersion??0,p.orderVersion??0);
      v.order={type:'reroute',receivedAt:w.now,version:p.orderVersion,rejectedAt:w.now,reason:`cargo:${e.code}`};
      w.record('reroute_rejected',{vehicle:v.id,reason:v.order.reason},op.id);w.reportOperation(op);w.reportVehicle(v);return;}}
    apply(v,p);};
  for(const kind of ['field_observe','repair_finish','task_arrival']){const handler=w.handlers.get(kind);w.on(kind,p=>{handler(p);
    for(const v of w.state.vehicles)if(v.crewQuantity)clearCrew(v);});}
  const cancel=w.cancelVehicle;w.cancelVehicle=(v,p)=>{cancel(v,p);clearCrew(v);};
}
