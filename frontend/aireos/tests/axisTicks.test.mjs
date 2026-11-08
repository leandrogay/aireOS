// Y-axis tick labels on the dashboard charts: one unit and one number of
// decimals per axis. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { axisTickFormatter } from '../app/utils/axisTicks.js';

const ticks = (axisMax, prefix) => {
  const format = axisTickFormatter(axisMax, 4, prefix);
  return [0, 1, 2, 3, 4].map((i) => format((axisMax / 4) * i));
};

// ---- Units ----

describe('axis units', () => {
  test('an axis reaching thousands shows every tick in k, even those under 1,000', () => {
    assert.deepEqual(ticks(3200, '$'), ['$0', '$0.8k', '$1.6k', '$2.4k', '$3.2k']);
  });

  test('an axis under 1,000 shows plain values with no decimals', () => {
    assert.deepEqual(ticks(800, '$'), ['$0', '$200', '$400', '$600', '$800']);
  });

  test('an axis reaching millions shows every tick in M', () => {
    assert.deepEqual(ticks(2_400_000, '$'), ['$0', '$0.6M', '$1.2M', '$1.8M', '$2.4M']);
  });

  test('units have no currency sign', () => {
    assert.deepEqual(ticks(20_000, ''), ['0', '5k', '10k', '15k', '20k']);
  });
});

// ---- Decimals ----

describe('axis decimals', () => {
  test('every tick keeps the same decimals, so whole thousands read 1.0k', () => {
    assert.deepEqual(ticks(2000, '$'), ['$0', '$0.5k', '$1.0k', '$1.5k', '$2.0k']);
  });

  test('whole-number steps get no decimals', () => {
    assert.deepEqual(ticks(24_000, '$'), ['$0', '$6k', '$12k', '$18k', '$24k']);
  });

  test('steps that need two decimals get two on every tick', () => {
    assert.deepEqual(ticks(1000, '$'), ['$0', '$0.25k', '$0.50k', '$0.75k', '$1.00k']);
  });
});

// ---- Negative values ----

describe('negative ticks', () => {
  test('a tick below zero puts its sign before the currency', () => {
    const format = axisTickFormatter(3200, 4, '$');
    assert.equal(format(-800), '-$0.8k');
  });

  test('negative units read like positive ones with a minus', () => {
    const format = axisTickFormatter(20_000, 4, '');
    assert.equal(format(-5000), '-5k');
  });
});
