// Chart transitions: blending a chart's numbers and y-axis range between two
// states (see hooks/useChartTransition). Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  blendSnapshots,
  chartSnapshot,
  hasDrawnValues,
  snapshotSignature,
  ticksWithin,
  withSnapshotValues,
} from '../app/utils/chartTransition.js';

const rows = (pairs) => pairs.map(([month, units]) => ({ month, label: `L-${month}`, units }));

// ---- Blending ----

describe('blendSnapshots', () => {
  test('moves values and the domain the same share of the way', () => {
    const from = chartSnapshot(rows([['2026-01', 100]]), 'month', ['units'], [0, 200]);
    const to = chartSnapshot(rows([['2026-01', 300]]), 'month', ['units'], [0, 400]);
    const half = blendSnapshots(from, to, 0.5);
    assert.equal(half.values.get('2026-01').units, 200);
    assert.deepEqual(half.domain, [0, 300]);
  });

  test('a new row grows from 0 and a dropped row is gone', () => {
    const from = chartSnapshot(rows([['2026-01', 100]]), 'month', ['units'], [0, 200]);
    const to = chartSnapshot(rows([['2026-02', 80]]), 'month', ['units'], [0, 200]);
    const quarter = blendSnapshots(from, to, 0.25);
    assert.equal(quarter.values.get('2026-02').units, 20);
    assert.equal(quarter.values.has('2026-01'), false);
  });

  test('a missing target value stays missing, so a line keeps its gap', () => {
    const from = chartSnapshot(rows([['2026-01', 100]]), 'month', ['units'], [0, 200]);
    const to = chartSnapshot(rows([['2026-01', null]]), 'month', ['units'], [0, 200]);
    assert.equal(blendSnapshots(from, to, 0.5).values.get('2026-01').units, null);
  });

  test('a [low, high] range blends each end', () => {
    const from = chartSnapshot([{ x: 0, range: [10, 20] }], 'x', ['range'], [0, 50]);
    const to = chartSnapshot([{ x: 0, range: [30, 60] }], 'x', ['range'], [0, 50]);
    assert.deepEqual(blendSnapshots(from, to, 0.5).values.get(0).range, [20, 40]);
  });

  test('negative values and domains blend through zero', () => {
    const from = chartSnapshot(rows([['2026-01', -100]]), 'month', ['units'], [-200, 200]);
    const to = chartSnapshot(rows([['2026-01', 100]]), 'month', ['units'], [0, 200]);
    const half = blendSnapshots(from, to, 0.5);
    assert.equal(half.values.get('2026-01').units, 0);
    assert.deepEqual(half.domain, [-100, 200]);
  });
});

// ---- Rows and ticks ----

describe('withSnapshotValues', () => {
  test('swaps in the numbers and keeps every other field', () => {
    const snapshot = chartSnapshot(rows([['2026-01', 5]]), 'month', ['units'], [0, 10]);
    const [row] = withSnapshotValues(rows([['2026-01', 9]]), 'month', snapshot);
    assert.deepEqual(row, { month: '2026-01', label: 'L-2026-01', units: 5 });
  });
});

describe('ticksWithin', () => {
  test('keeps only the ticks inside the current domain', () => {
    assert.deepEqual(ticksWithin([0, 100, 200, 300, 400], [0, 250]), [0, 100, 200]);
  });

  test('keeps an end tick that float drift put just outside', () => {
    assert.deepEqual(ticksWithin([0, 0.3], [0, 0.30000000000000004 - 1e-9]), [0, 0.3]);
  });

  test('passes undefined ticks through, for an axis that picks its own', () => {
    assert.equal(ticksWithin(undefined, [0, 1]), undefined);
  });
});

describe('snapshotSignature', () => {
  test('changes when a value or the domain changes, not otherwise', () => {
    const a = chartSnapshot(rows([['2026-01', 5]]), 'month', ['units'], [0, 10]);
    const same = chartSnapshot(rows([['2026-01', 5]]), 'month', ['units'], [0, 10]);
    const value = chartSnapshot(rows([['2026-01', 6]]), 'month', ['units'], [0, 10]);
    const domain = chartSnapshot(rows([['2026-01', 5]]), 'month', ['units'], [0, 20]);
    assert.equal(snapshotSignature(a), snapshotSignature(same));
    assert.notEqual(snapshotSignature(a), snapshotSignature(value));
    assert.notEqual(snapshotSignature(a), snapshotSignature(domain));
  });
});

// ---- First draw ----

describe('hasDrawnValues', () => {
  test('is false for no rows and for rows that are all empty', () => {
    assert.equal(hasDrawnValues(chartSnapshot([], 'month', ['units'], [0, 1])), false);
    assert.equal(hasDrawnValues(chartSnapshot(rows([['2026-01', null]]), 'month', ['units'], [0, 1])), false);
  });

  test('is true once any row has a value, including 0', () => {
    assert.equal(hasDrawnValues(chartSnapshot(rows([['2026-01', null], ['2026-02', 0]]), 'month', ['units'], [0, 1])), true);
  });
});
