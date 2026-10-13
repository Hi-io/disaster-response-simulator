import { clone, digest } from './determinism.mjs';

// Contact is evidence of a delivered message, never evidence that a sector is
// safe. Neither private coverage nor observer demand enters this projection.
export function installCoverage(w) {
  const deliver=w.handlers.get('message_deliver');
  w.on('message_deliver',p=>{
    const message=w.lookup('messages',w.state.messages,p.id),wasDelivered=message?.state==='delivered';
    deliver(p);
    if(wasDelivered||message?.state!=='delivered'||!w.state.observations[message.to])return;
    const payload=message.payload,inspection=payload.kind==='verification'?w.state.inspections.find(i=>i.id===payload.inspection):null;
    let building,sector,observedAt;
    if(payload.kind==='need_observation'){building=payload.need?.building;sector=message.sector;observedAt=payload.observedAt;}
    if(payload.kind==='verification'&&payload.result&&inspection?.target==='building'&&payload.result.id===inspection.entity){
      building=payload.result.id;sector=message.sector;observedAt=payload.observedAt;
    }
    if(payload.kind==='verification'&&payload.result&&inspection?.target==='need'){
      building=payload.result.building;sector=message.sector;observedAt=payload.observedAt;
    }
    if(payload.kind==='population_observation'){sector=payload.snapshot?.sector;observedAt=payload.snapshot?.observedAt;}
    if(!w.sector(sector)||!Number.isSafeInteger(observedAt)||observedAt<0||observedAt>w.now)return;
    const known=w.state.observations[message.to];known.sectorContacts??={};
    known.sectorContacts[sector]=Math.max(known.sectorContacts[sector]??-1,observedAt);
    if(building&&w.building(building)?.sector===sector){
      known.buildingContacts??={};const old=known.buildingContacts[building];
      if(!old||observedAt>old.lastContactAt)known.buildingContacts[building]={building,sector,lastContactAt:observedAt,receivedAt:w.now};
    }

  });
  w.onAction('coverage',a=>{
    const known=w.state.observations[a.org],contacts=Object.entries(known.sectorContacts??{})
      .sort(([a],[b])=>a.localeCompare(b)).map(([sector,lastContactAt])=>({sector,lastContactAt}));
    const buildingContacts=Object.values(known.buildingContacts??{}).sort((a,b)=>a.building.localeCompare(b.building));
    const signature=digest({contacts,buildingContacts});known.coverageReceipt??={version:1,observedAt:w.now,signature};
    if(known.coverageReceipt.signature!==signature)known.coverageReceipt={version:known.coverageReceipt.version+1,observedAt:w.now,signature};
    return {version:known.coverageReceipt.version,observedAt:known.coverageReceipt.observedAt,contacts:clone(contacts),buildingContacts:clone(buildingContacts),
      scope:'received',unknownSectors:'not inferred as safe',knownBuildings:Object.keys(known.buildings).length};
  });
}
