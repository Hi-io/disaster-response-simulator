import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../engine/world.mjs';
import { validateConfig, CONFIG_SCHEMA } from '../contracts/config.mjs';
import { HONMURA_SOURCE, honmuraRoads } from '../generators/honmura.mjs';
import { route } from '../generators/map.mjs';
import { replay } from '../evaluation/runs.mjs';

const quiet = { topology: 'honmura', seed: 'honmura-test', hazard: 'none', policy: 'none',
  postsPerHour: 0, backgroundTraffic: 0, packetLoss: 0, logMode: 'full' };
const vehicle = { weightKg: 3500, speedMps: 10, maxWaterDepth: 0.3 };

test('Honmura is a fixed, connected geographic graph with original source provenance and metre geometry', () => {
  const a = honmuraRoads(), b = honmuraRoads();
  assert.deepEqual(a,b);
  assert.equal(a.nodes.length,43);
  assert.equal(a.edges.length,112);
  assert.equal(new Set(a.edges.map(e=>e.id)).size,112);
  assert.equal(a.river,null);
  assert.equal(a.crossings.length,0,'no imaginary bridge is introduced into Honmura');
  assert.ok(a.edges.some(e=>e.name==='Prefectural Route 256' && e.osmWay==='75615718'));
  assert.ok(a.nodes.some(n=>n.name==='Honmura Port approach'));
  assert.ok(a.edges.some(e=>e.points.length>5),'mapped curves remain in the graph');
  const reached = new Set([a.nodes[0].id]), queue = [a.nodes[0].id];
  while(queue.length){const id=queue.pop();for(const edge of a.edges.filter(e=>e.from===id))if(!reached.has(edge.to)){reached.add(edge.to);queue.push(edge.to);}}
  assert.equal(reached.size,a.nodes.length);
  for (const edge of a.edges) {
    const from=a.nodes.find(n=>n.id===edge.from),to=a.nodes.find(n=>n.id===edge.to);
    assert.deepEqual(edge.points[0],{x:from.x,z:from.z});
    assert.deepEqual(edge.points.at(-1),{x:to.x,z:to.z});
    assert.ok(edge.lengthM>=Math.floor(Math.hypot(from.x-to.x,from.z-to.z)));
    const reverse=a.edges.find(e=>e.from===edge.to&&e.to===edge.from);
    assert.equal(reverse.lengthM,edge.lengthM);
    assert.deepEqual(reverse.points,[...edge.points].reverse());
  }
  assert.equal(HONMURA_SOURCE.license,'ODbL-1.0');
  assert.match(HONMURA_SOURCE.source,/openstreetmap.org/);
  assert.match(HONMURA_SOURCE.sourceSha256,/^[a-f0-9]{64}$/);
  assert.match(HONMURA_SOURCE.scope,/synthetic/);
  assert.equal(CONFIG_SCHEMA.properties.topology.enum.includes('honmura'),true);
  assert.equal(validateConfig({topology:'honmura',extentKm:160,grid:25}).extentKm,1);
  assert.equal(validateConfig({topology:'honmura'}).grid,7);
  assert.equal(validateConfig().topology,'regional');
});

test('geographic roads stay fixed across seeds while synthetic world data remains seeded and population is conserved', () => {
  const a=new World(quiet),b=new World(quiet),other=new World({...quiet,seed:'other'});
  try{
    assert.equal(a.state.map.hash,b.state.map.hash);
    assert.deepEqual(a.state.map.edges,other.state.map.edges);
    assert.equal(a.state.map.buildings.length,43);
    assert.equal(a.state.initialPopulation,43*a.config.populationPerSector);
    assert.ok(a.state.map.buildings.every(x=>x.synthetic&&x.name.includes('Demo')));
    assert.ok(a.state.map.nodes.every(x=>Number.isFinite(x.lon)&&Number.isFinite(x.lat)&&x.osmNode));
    assert.equal(new Set(a.state.map.organizations.map(x=>x.node)).size,4);
    for(const org of a.state.map.organizations)assert.ok(route(a.state.map,org.node,a.building(a.state.map.shelterId).node,vehicle));
    for(const w of[a,b,other]){w.advance(3600000);assert.deepEqual(w.invariants(),[]);}
    const result=replay(a.checkpoint());
    assert.equal(result.matches,true);result.world.close();
    const actor=a.actorView('org0');
    assert.equal(JSON.stringify(actor).includes('truthCategory'),false);
  }finally{a.close();b.close();other.close();}
});

test('an actual mapped dead-end can be isolated and reopening restores the physical route', () => {
  const w=new World(quiet);
  try{
    const map=w.state.map;
    const leaf=map.nodes.find(n=>map.edges.filter(e=>e.from===n.id).length===1);
    assert.ok(leaf);
    const exit=map.edges.find(e=>e.from===leaf.id);
    assert.ok(route(map,leaf.id,exit.to,vehicle));
    w.inject('road_change',{edge:exit.id,open:false,reason:'synthetic_debris'});
    assert.equal(route(map,leaf.id,exit.to,vehicle),null);
    w.inject('road_change',{edge:exit.id,open:true,reason:'clearance_confirmed'});
    assert.ok(route(map,leaf.id,exit.to,vehicle));
    assert.deepEqual(w.invariants(),[]);
  }finally{w.close();}
});

test('each disaster runs on the real graph without procedural-river artifacts or invariant violations', () => {
  for(const hazard of['earthquake','wildfire','flood','compound']){
    const w=new World({...quiet,hazard,backgroundTraffic:12});
    try{
      w.advance(12*60000);assert.deepEqual(w.invariants(),[],hazard);
      if(['flood','compound'].includes(hazard)){
        assert.ok(w.state.hazards.some(h=>h.kind==='flood'&&h.radius===95));
        assert.ok(w.state.map.edges.some(e=>e.waterDepth>0));
      }
    }finally{w.close();}
  }
  const html=readFileSync(new URL('../viewer/index.html',import.meta.url),'utf8');
  assert.match(html,/value="honmura"/);
  assert.match(html,/id="mapAttribution"/);
});

test('authorized cargo traverses mapped Honmura streets and changes need only after physical receipt', () => {
  const w=new World(quiet);
  try {
    const response=w.act({id:'town-owner',org:'org0',role:'commander'}, {type:'dispatch',params:{
      resource:'r-org0-water',vehicle:'v-org0-0',need:'need-water-main',quantity:300},idempotencyKey:'town-delivery'});
    assert.equal(w.need('need-water-main').served,0);
    w.advance(1800000);
    const op=w.state.operations.find(x=>x.id===response.id);
    assert.equal(op.state,'completed');
    assert.equal(op.received,300);
    assert.ok(op.times.arrived>op.times.dispatched);
    assert.ok(op.times.received>op.times.arrived);
    assert.equal(w.need('need-water-main').served,300);
    assert.deepEqual(w.invariants(),[]);
  } finally { w.close(); }
});
