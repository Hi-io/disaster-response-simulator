import test from 'node:test';
import assert from 'node:assert/strict';
import { simulationTitle } from '../viewer/presentation.js';

test('a live world without an active hazard has a useful title', () => {
  for (const hazard of ['none', '', '  ', undefined, null])
    assert.equal(simulationTitle(hazard), 'Live simulation');
});

test('a named disaster retains its specific simulation title', () => {
  for (const [hazard, title] of [['flood', 'Flood simulation'],
    ['earthquake', 'Earthquake simulation'], ['wildfire', 'Wildfire simulation']])
    assert.equal(simulationTitle(hazard), title);
});
