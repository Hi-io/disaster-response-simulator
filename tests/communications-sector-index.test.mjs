import test from 'node:test';
import assert from 'node:assert/strict';
import { installCommunications } from '../engine/communications.mjs';
import { World } from '../engine/world.mjs';

const sector = (id, node) => ({ id, node, coverage: 1, energy: true, battery: 100,
  channels: { internet: true, cellular: true, landline: true, radio: true } });
function fixture() {
  const w = { state: { map: { sectors: [sector('first','n0'), sector('other','n1'), sector('duplicate','n0')],
    nodes: [{ id:'n0',coverageSectorId:'other' },{ id:'n1' },{ id:'road',coverageSectorId:'other' },
      { id:'unmodelled' },{ id:'invalid',coverageSectorId:'missing-sector' }] } },
    on() {}, sector(id) { return this.state.map.sectors.find(s => s.id === id); } };
  installCommunications(w); return w;
}

test('the first own sector wins and only explicit valid coverage applies to road-only nodes', () => {
  const w = fixture();
  assert.equal(w.sectorForNode('n0'),'first', 'an explicit fallback cannot replace an own community');
  assert.equal(w.sectorForNode('road'),'other');
  assert.equal(w.sectorForNode('unmodelled'),undefined);
  assert.equal(w.sectorForNode('invalid'),undefined);
  assert.equal(w.sectorForNode('missing-node'),undefined);
  w.sector('other').coverage = 0;
  assert.equal(w.connected(w.sectorForNode('road')),false, 'the road shares actual outage state, not default connectivity');
  w.sector('other').coverage = 1;
  assert.equal(w.connected(w.sectorForNode('road')),true);
});

test('appending, replacing and shrinking sector/node arrays invalidates derived lookup state', () => {
  const w = fixture();
  assert.equal(w.sectorForNode('road'),'other');
  w.state.map.sectors.push(sector('new-own','road'));
  assert.equal(w.sectorForNode('road'),'new-own');
  w.state.map.nodes.push({ id:'new-road',coverageSectorId:'new-own' });
  assert.equal(w.sectorForNode('new-road'),'new-own');
  w.state.map.sectors = [sector('replacement','n0')];
  assert.equal(w.sectorForNode('n0'),'replacement');
  assert.equal(w.sectorForNode('road'),undefined, 'removed coverage cannot remain cached');
  w.state.map.nodes = [{ id:'road',coverageSectorId:'replacement' }];
  assert.equal(w.sectorForNode('road'),'replacement');
  w.state.map.sectors.length = 0;
  assert.equal(w.sectorForNode('road'),undefined);
});

test('grid and Honmura lookups retain exact original behavior and checkpoint continuation', t => {
  for (const topology of ['grid','honmura']) {
    const w = new World({ topology,grid:3,extentKm:1,hazard:'none',policy:'none',
      postsPerHour:0,backgroundTraffic:0,recurringNeeds:false,packetLoss:0 });
    t.after(() => w.close());
    const before = w.stateHash();
    for (const node of w.state.map.nodes)
      assert.equal(w.sectorForNode(node.id),w.state.map.sectors.find(s => s.node === node.id)?.id);
    assert.equal(w.stateHash(),before,'derived indexes are not serialized');
    const checkpoint=w.checkpoint(), resumed=new World(w.config,checkpoint);
    t.after(() => resumed.close());
    w.advance(60000); w.restore(checkpoint);
    for (const node of w.state.map.nodes)
      assert.equal(w.sectorForNode(node.id),w.state.map.sectors.find(s => s.node === node.id)?.id);
    w.advance(120000); resumed.advance(120000);
    assert.equal(w.stateHash(),resumed.stateHash());
    assert.deepEqual(w.invariants(),[]);
  }
});

test('a vehicle on an explicitly covered road node waits for a real connection before receiving its message', t => {
  const w=new World({ topology:'grid',grid:3,extentKm:1,hazard:'none',policy:'none',
    postsPerHour:0,backgroundTraffic:0,recurringNeeds:false,packetLoss:0,networkLatencyMs:1000 });
  t.after(() => w.close());
  const covered=w.sector('s1'); covered.coverage=0;
  w.state.map.nodes.push({ id:'road-only-test',x:0,z:0,coverageSectorId:covered.id });
  const vehicle=w.vehicle('v-org0-0'); vehicle.node='road-only-test';
  const message=w.send({kind:'covered-road-probe'},'org0',{target:vehicle.id,ttlMs:120000});
  w.advance(1000);
  assert.equal(message.state,'offline'); assert.equal(message.times.delivered,undefined);
  covered.coverage=1; w.advance(40000);
  assert.equal(message.state,'delivered'); assert.ok(message.times.delivered>=30000);
  assert.deepEqual(w.invariants(),[]);
});
