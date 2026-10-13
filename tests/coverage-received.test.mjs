import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine/world.mjs';
import {replay} from '../evaluation/runs.mjs';
let serial=0;
const act=(w,type,params={},org='org0')=>w.act({id:`owner-${org}`,org,role:'commander'},{type,params,idempotencyKey:`coverage-${++serial}`});
const fixture=()=>new World({scenario:'S23',policy:'none',seed:'received-sector-contact',hazard:'none',grid:3,extentKm:1,topology:'grid',
  organizations:2,durationMs:3600000,postsPerHour:0,backgroundTraffic:0,healthReports:false,recurringNeeds:false,packetLoss:0,networkLatencyMs:1000});
test('map coverage directory is static and a silent sector remains an unknown gap even if private state has demand',()=>{
  const w=fixture(),query=act(w,'query',{target:'map'});w.advance(30000);
  const map=w.actorView('org0').queries.find(q=>q.id===query.id).result;
  assert.equal(map.sectors.length,9);assert.ok(map.places.every(b=>map.sectors.some(s=>s.id===b.sector)));
  assert.ok(map.sectors.every(s=>Object.keys(s).every(k=>['id','node','name','jurisdiction'].includes(k))));
  const r=act(w,'coverage');assert.equal(r.scope,'received');assert.equal(r.unknownSectors,'not inferred as safe');
  const silent=map.sectors.find(s=>!r.contacts.some(c=>c.sector===s.id));assert.ok(silent);
  assert.equal(Object.keys(r).some(k=>/actual|safe|need/.test(k)),false);
  const material=act(w,'coverage');assert.equal(material.version,r.version);assert.equal(material.observedAt,r.observedAt);
  assert.deepEqual(w.invariants(),[]);w.close();
});
test('only delivered explicit-sector messages update scoped contact; offline sends and target-only telemetry do not fabricate contact',()=>{
  const w=fixture(),sector=w.state.map.sectors.find(s=>s.id!==w.sectorForNode(w.organization('org0').node)).id;
  const original=act(w,'coverage');w.sector(sector).coverage=0;
  const b=w.state.map.buildings.find(b=>b.sector===sector);
  w.send({kind:'need_observation',need:{id:'received-example',building:b.id,type:'water',quantity:1,served:0,version:1},observedAt:w.now},'org0',{sector});w.advance(10000);
  assert.equal(act(w,'coverage').contacts.some(c=>c.sector===sector),false);
  w.sector(sector).coverage=1;w.advance(40000);
  const actual=act(w,'coverage');assert.ok(actual.contacts.some(c=>c.sector===sector));assert.ok(actual.buildingContacts.some(c=>c.building===b.id));assert.ok(actual.version>original.version);
  assert.equal(act(w,'coverage',{},'org1').contacts.some(c=>c.sector===sector),false);
  const contact=actual.contacts.find(c=>c.sector===sector).lastContactAt;
  w.send({kind:'contact_only'},'org0',{target:'v-org0-0'});w.advance(43000);
  assert.equal(act(w,'coverage').contacts.find(c=>c.sector===sector).lastContactAt,contact);
  assert.deepEqual(w.invariants(),[]);w.close();
});

test('a bounded directory sweep discovers an otherwise silent S07 need only after real field travel and a received report',()=>{
  const base=fixture(),config=base.config;base.close();
  const w=new World({...config,scenario:'S07',policy:'none',inspectionMs:1000,observationRate:1});
  const query=act(w,'query',{target:'map'});w.advance(30000);
  const map=w.actorView('org0').queries.find(q=>q.id===query.id).result;
  const before=act(w,'coverage'),gaps=map.places.filter(b=>!before.buildingContacts.some(c=>c.building===b.id));
  assert.ok(gaps.length>0);let discovered;
  // The controller takes the first uncontacted public directory entries. The
  // hidden scenario need ID is used only in assertions after the inquiry.
  for(const place of gaps.slice(0,6)){
    const i=act(w,'verify',{target:'building',id:place.id,method:'field',purpose:'observation'});
    let count=0;while(!w.actorView('org0').inspections.some(x=>x.id===i.id&&['completed','inconclusive'].includes(x.state))&&count++<20000)assert.ok(w.step());
    const extra=Object.values(w.actorView('org0').known.needs).find(n=>n.id!=='need-water-main');
    if(extra){discovered=extra;break;}
  }
  assert.ok(discovered);const contact=act(w,'coverage').buildingContacts.find(c=>c.building===discovered.building);assert.ok(contact);
  assert.ok(w.state.operations.some(o=>o.type==='inspection'&&o.times.service>o.times.authorized));
  assert.deepEqual(w.invariants(),[]);w.advance(w.now);const result=replay(w.checkpoint());assert.equal(result.matches,true);result.world.close();w.close();
});
