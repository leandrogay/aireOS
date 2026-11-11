import { test } from 'node:test';
import assert from 'node:assert/strict';

import { spinRemainingMs } from '../app/utils/refreshSpin.js';

const TIMING = { turn: 1, minTurns: 1 };

// ---- spinRemainingMs ----

test('a reload that answers at once still spins one whole turn', () => {
  assert.equal(spinRemainingMs(1000, 1050, TIMING), 950);
});

test('a slower reload finishes the turn it is in', () => {
  assert.equal(spinRemainingMs(0, 1400, TIMING), 600);
});

test('a reload landing exactly on a turn stops there', () => {
  assert.equal(spinRemainingMs(0, 2000, TIMING), 0);
});

test('minTurns sets the shortest spin', () => {
  assert.equal(spinRemainingMs(0, 300, { turn: 0.5, minTurns: 2 }), 700);
});
