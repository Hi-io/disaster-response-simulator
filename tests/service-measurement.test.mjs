import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine/world.mjs';
import {createResource} from '../engine/ledger.mjs';
import {evaluate} from '../evaluation/metrics.mjs';
test('occupied place-hours count occupancy over time, never empty opening hours',()=>{
 const w=new World({policy:'none',hazard:'none',grid:5,topology:'grid',postsPerHour:0,backgroundTraffic:0,durationMs:86400000});const b=w.building(w.state.map.shelterId);
 b.state='operating';b.serviceIntegratedAt=0;b.occupancy=0;w.advance(3600000);assert.equal(evaluate(w).collective.shelterPlaceHours,0);
 // This is an arithmetic fixture, not a claimed physical evacuation episode.
 w.integrateFacility(b);b.occupancy=50;w.advance(7200000);assert.equal(evaluate(w).collective.shelterPlaceHours,50);w.closeFacility(b,'fixture-closure');w.advance(10800000);assert.equal(evaluate(w).collective.shelterPlaceHours,50);
});
test('fractional-minute consumption conserves daily water without rounding each minute upward',()=>{
 const w=new World({policy:'none',hazard:'none',grid:5,topology:'grid',postsPerHour:0,backgroundTraffic:0,durationMs:86400000,waterMlPerPersonDay:2000});const b=w.building(w.state.map.shelterId);b.state='operating';b.damage=0;b.occupancy=50;b.serviceIntegratedAt=0;
 const water=createResource(`stock-${b.node}-water`,'org0',b.node,'water',2000);w.state.resources.push(water);w.schedule(60000,'shelter_service',{building:b.id,org:'org0'},4,'measurement');w.advance(86400000);
 assert.equal(water.consumed,100);assert.equal(water.quantity,1900);assert.equal(b.waterConsumptionRemainder,0);assert.equal(evaluate(w).collective.shelterPlaceHours,1200);
});
