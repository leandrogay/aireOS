// Placeholder line paths for ui/LineChartSkeleton. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { skeletonLinePath } from '../app/utils/chartSkeleton.js';

describe('skeletonLinePath', () => {
  test('no heights draws nothing', () => {
    assert.equal(skeletonLinePath([]), '');
  });

  test('a single height is one point in the middle of the plot', () => {
    assert.equal(skeletonLinePath([40]), 'M 50 60');
  });

  test('points sit mid-slot and are joined by eased curves', () => {
    assert.equal(
      skeletonLinePath([20, 80]),
      'M 25 80 C 50 80 50 20 75 20',
    );
  });

  test('every height after the first adds one curve', () => {
    const path = skeletonLinePath([30, 50, 70, 40]);
    assert.equal(path.match(/ C /g).length, 3);
    assert.ok(path.endsWith(' 87.5 60'));
  });
});
