import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine/world.mjs';
import { CONFIG_SCHEMA, validateConfig } from '../contracts/config.mjs';
import { generateMap, route } from '../generators/map.mjs';
import { digest } from '../engine/determinism.mjs';

const quiet = { topology:'takamatsu', seed:'takamatsu-world-test', hazard:'none', policy:'none',
  mode:'headless', postsPerHour:0, backgroundTraffic:0, packetLoss:0, recurringNeeds:false };
const truck = { weightKg:3500, speedMps:12, maxWaterDepth:0.3 };

test('city configuration scales area and actual modelled communities by 100 without stretching Honmura', () => {
  const c=validateConfig({...quiet,extentKm:1,grid:3});
  assert.equal(c.extentKm,10); assert.equal(c.grid,66);
  assert.ok(CONFIG_SCHEMA.properties.topology.enum.includes('takamatsu'));
  const map=generateMap(c), town=generateMap(validateConfig({topology:'honmura'}));
  assert.equal((map.extentM/town.extentM)**2,100);
  assert.equal(map.buildings.length,town.buildings.length*100);
  assert.equal(map.sectors.length,4300);
  assert.ok(map.nodes.length>town.nodes.length*100);
  const ids=new Set(map.nodes.map(n=>n.id));
  assert.ok(map.buildings.every(b=>b.synthetic&&ids.has(b.node)&&b.name.includes('(Demo)')));
  assert.ok(map.sectors.every(s=>ids.has(s.node)));
  const sectorIds=new Set(map.sectors.map(s=>s.id));
  assert.ok(map.nodes.every(n=>sectorIds.has(n.coverageSectorId)));
  assert.ok(map.buildings.some(b=>b.id===map.shelterId));
  assert.ok(map.buildings.some(b=>b.id===map.plantId));
  assert.equal(new Set(map.organizations.map(o=>o.node)).size,c.organizations);
  for(const org of map.organizations)assert.ok(route(map,org.node,map.buildings.find(b=>b.id===map.shelterId).node,truck));
  const other=generateMap({...c,seed:'different-synthetic-city'});
  assert.equal(digest(map.nodes),digest(other.nodes));
  assert.equal(digest(map.edges),digest(other.edges));
  assert.notEqual(digest(map.buildings),digest(other.buildings));
});

test('a physical delivery crosses the large real street graph and changes demand only after receipt', () => {
  const w=new World(quiet);
  try {
    assert.equal(w.state.initialPopulation,4300*w.config.populationPerSector);
    const result=w.act({id:'city-operator',org:'org0',role:'commander'},{type:'dispatch',params:{
      resource:'r-org0-water',vehicle:'v-org0-0',need:'need-water-main',quantity:300},idempotencyKey:'city-delivery'});
    assert.equal(w.need('need-water-main').served,0);
    w.advance(3*3600000);
    const op=w.state.operations.find(o=>o.id===result.id);
    assert.equal(op.state,'completed'); assert.equal(op.received,300);
    assert.ok(op.times.arrived>op.times.dispatched);
    assert.ok(op.times.received>op.times.arrived);
    assert.equal(w.need('need-water-main').served,300);
    assert.deepEqual(w.invariants(),[]);
  } finally { w.close(); }
});

test('large-map earthquake creates concurrent needs and survives an exact checkpoint continuation', () => {
  const w=new World({...quiet,hazard:'earthquake',backgroundTraffic:24,postsPerHour:240});
  let restored;
  try {
    w.advance(10*60000);
    assert.ok(w.state.needs.length>100,'the city has many simultaneous actual cases');
    assert.deepEqual(w.invariants(),[]);
    restored=new World(w.config,w.checkpoint());
    w.advance(12*60000); restored.advance(12*60000);
    assert.equal(w.stateHash(),restored.stateHash());
    assert.deepEqual(restored.invariants(),[]);
  } finally { w.close(); restored?.close(); }
});
