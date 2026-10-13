import { release } from './ledger.mjs';
import { requireCondition as check } from '../contracts/actions.mjs';

export const driverAvailable = v => !!v && (v.background ||
  v.driverAvailable !== false && typeof v.driver === 'string' && v.driver.length > 0);

export function installVehicleDriver(w) {
  w.vehicleDriverAvailable=driverAvailable;
  const view=w.vehicleView.bind(w);
  w.vehicleView=v=>({...view(v),driverAvailable:driverAvailable(v)});
  for(const kind of ['dispatch','reroute','evacuate','verify']){
    const handler=w.actionHandlers.get(kind);
    w.onAction(kind,(actor,p,request)=>{
      const v=w.vehicle(p.vehicle);
      if(v?.owner===actor.org && !(kind==='verify'&&p.method==='clarification'))
        check(driverAvailable(v),'VEHICLE_DRIVER','The assigned vehicle has no available driver');
      return handler(actor,p,request);
    });
  }
  const fail= (v,op)=>{
    if(op){op.failure='driver_unavailable';
      if(v.load||v.passengers){op.state='blocked';v.state='blocked';}
      else {
        op.state='failed';op.times.failed=w.now;
        const c=w.state.commitments.find(c=>c.id===op.commitment);
        if(c&&['confirmed','reserved'].includes(c.state)){
          release(w.resource(c.resource),c.quantity,c.staffReservation);c.state='released';c.version++;
        }
        const i=w.state.inspections.find(i=>i.operation===op.id),r=w.state.repairs?.find(r=>r.operation===op.id),
          e=w.state.evacuations?.find(e=>e.operation===op.id),t=w.state.transfers?.find(t=>t.id===op.transfer);
        if(i){w.releaseStaff(i.staff);i.state='inconclusive';i.failure=op.failure;
          w.send({kind:'verification',inspection:i.id,result:null,observedAt:w.now},i.org,{sector:w.sectorForNode(v.node)});}
        if(r){w.releaseStaff(r.staff);r.state='failed';r.failure=op.failure;}
        if(e&&!['failed','completed'].includes(e.state)){
          e.state='failed';e.failure=op.failure;w.need(e.need).inTransit-=e.quantity;w.building(e.to).reservedPlaces-=e.quantity;
        }
        if(t){t.state='failed';t.failure=op.failure;}
        v.operation=null;v.state='idle';
      }
      w.reportOperation(op);
    }else v.state='blocked';
    w.reportVehicle(v);w.record('vehicle_driver_unavailable',{vehicle:v.id},op?.id??v.id);return false;
  };
  const trip=w.startTrip;
  w.startTrip=(v,destination,op=null)=>driverAvailable(v)?trip(v,destination,op):fail(v,op);
  const enter=w.handlers.get('vehicle_enter');
  w.on('vehicle_enter',p=>{
    const v=w.vehicle(p.vehicle);
    // A moving truck reaches its next safe vertex before stopping. Removing
    // a driver never teleports cargo or erases passengers already aboard.
    if(v&&!v.edge&&!['idle','arrived','cancelled','failed'].includes(v.state)&&!driverAvailable(v)){
      fail(v,w.state.operations.find(o=>o.id===v.operation));return;
    }
    enter(p);
  });
  const load=w.handlers.get('load');
  w.on('load',p=>{
    const op=w.state.operations.find(o=>o.id===p.operation),v=w.vehicle(op?.vehicle);
    if(op&&v&&!['failed','cancelled','completed'].includes(op.state)&&!driverAvailable(v)){
      fail(v,op);return;
    }
    load(p);
  });
  const intervention=w.handlers.get('lab_intervention');
  w.on('lab_intervention',p=>{
    if(p.kind!=='vehicle_driver')return intervention(p);
    const v=w.vehicle(p.vehicle);
    if(v.driverAvailable===p.available)return;
    v.driverAvailable=p.available;w.reportVehicle(v);
    w.record('vehicle_driver_changed',{vehicle:v.id,available:p.available});
  });
}
