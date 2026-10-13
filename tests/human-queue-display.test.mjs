import test from 'node:test';
import assert from 'node:assert/strict';
import { humanQueueRows } from '../viewer/display.js';

test('human queue display preserves waiting and unconfirmed tasks without crediting aid', () => {
  const rows = humanQueueRows({now:120000,state:{humanWork:[
    {org:'org0',stage:'read',state:'queued',createdAt:30000},
    {org:'org0',stage:'read',state:'completed',createdAt:0},
    {org:'org0',stage:'decide',state:'inconclusive',createdAt:0},
    {org:'org0',stage:'relay',state:'awaiting_delivery',createdAt:0},
  ]}});
  assert.equal(rows[0].queued,1); assert.equal(rows[0].oldestQueuedMs,90000);
  assert.equal(rows[0].completed,1); assert.equal(rows[1].unconfirmed,1);
  assert.equal(rows[2].completed,0); assert.equal(rows[2].awaitingDelivery,1);
});

test('actor human queue counts exclude other owners and private payloads', () => {
  const snapshot = {now:100,state:{humanWork:[
    {org:'org0',stage:'read',state:'queued',createdAt:50,privatePayload:{secret:'local'}},
    {org:'org1',stage:'read',state:'queued',createdAt:0,privatePayload:{secret:'foreign'}},
  ]}};
  const rows = humanQueueRows(snapshot,'org0');
  assert.equal(rows[0].queued,1); assert.equal(rows[0].oldestQueuedMs,50);
  assert.equal(JSON.stringify(rows).includes('secret'),false);
  assert.equal(humanQueueRows(snapshot,'unknown')[0].queued,0);
});

test('legacy absent human work stays empty and malformed clocks are not elapsed time', () => {
  assert.equal(humanQueueRows({state:{}}).every(r => r.queued === 0 && r.oldestQueuedMs === null),true);
  const row = humanQueueRows({now:100,state:{humanWork:[{stage:'read',state:'queued',createdAt:200},{stage:'read',state:'queued',createdAt:null}]}})[0];
  assert.equal(row.queued,2); assert.equal(row.oldestQueuedMs,null);
});
