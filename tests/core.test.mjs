import test from 'node:test';
import assert from 'node:assert/strict';
import {EventQueue,keyedRandom,digest} from '../engine/determinism.mjs';
import {validateConfig} from '../contracts/config.mjs';
import {validateAction} from '../contracts/actions.mjs';

test('independent keyed draws are reproducible and not affected by extra queries',()=>{
  const before=keyedRandom('s','hazard','a','b');for(let i=0;i<100;i++) keyedRandom('s','tools','x','q',i);
  assert.equal(before,keyedRandom('s','hazard','a','b'));assert.notEqual(before,keyedRandom('s','hazard','a','c'));
  assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));
});
test('event heap obeys deterministic time, phase and key order',()=>{
  const q=new EventQueue();for(const e of [{at:2,phase:0,key:'a',seq:1},{at:1,phase:2,key:'a',seq:3},{at:1,phase:0,key:'b',seq:2},{at:1,phase:0,key:'a',seq:4}])q.push(e);
  assert.deepEqual([q.pop().seq,q.pop().seq,q.pop().seq,q.pop().seq],[4,2,3,1]);assert.equal(q.pop(),null);
  assert.throws(()=>q.push({at:1.2}),/integer/);
});
test('configuration rejects impossible, unknown and fractional inputs',()=>{
  assert.equal(validateConfig({seed:42}).seed,'42');
  for(const c of [{grid:2},{grid:3.2},{packetLoss:2},{reservedWater:5000},{oops:true}]) assert.throws(()=>validateConfig(c));
});
test('commands cannot self-declare role or omit idempotency',()=>{
  assert.throws(()=>validateAction({type:'dispatch',params:{},idempotencyKey:'one',role:'admin'}),/Identity/);
  assert.throws(()=>validateAction({type:'dispatch',params:{}}),/idempotency/);
});
