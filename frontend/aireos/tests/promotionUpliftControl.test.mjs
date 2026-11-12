import test from 'node:test';
import assert from 'node:assert/strict';

import { promotionUpliftControl } from '../app/utils/promotionUpliftControl.js';

test('the selected mechanic expected uplift is the default slider value and the value applied', () => {
  const state = promotionUpliftControl([10]);
  assert.equal(state.sliderValue, 10);
  assert.deepEqual(state.applied, [10]);
  assert.equal(state.overridden, false);
  assert.equal(state.spread, false);
});

test('a spread within one customer uses every expected value instead of its single saved reference', () => {
  const state = promotionUpliftControl([10, 8, 12]);
  assert.deepEqual(state.expected, [10, 8, 12]);
  assert.deepEqual(state.applied, [10, 8, 12]);
  assert.equal(state.reference, 10);
  assert.equal(state.spread, true);
});

test('moving the slider replaces all expected values with one explicit override', () => {
  const state = promotionUpliftControl([8, 10, 12], 15);
  assert.deepEqual(state.expected, [8, 10, 12]);
  assert.deepEqual(state.applied, [15]);
  assert.equal(state.sliderValue, 15);
  assert.equal(state.overridden, true);
});

test('an override at the range midpoint remains an override until explicitly reset', () => {
  const state = promotionUpliftControl([8, 12], 10);
  assert.equal(state.overridden, true);
  assert.deepEqual(state.applied, [10]);
  const reset = promotionUpliftControl(state.expected, null);
  assert.equal(reset.overridden, false);
  assert.deepEqual(reset.applied, [8, 12]);
});

test('zero and negative overrides are retained, including the ordinary-month zero expectation', () => {
  assert.equal(promotionUpliftControl([10], 0).overridden, true);
  assert.deepEqual(promotionUpliftControl([10], 0).applied, [0]);
  assert.equal(promotionUpliftControl([10], -5).sliderValue, -5);
  assert.equal(promotionUpliftControl([0]).spread, false);
  assert.deepEqual(promotionUpliftControl([0]).applied, [0]);
});

test('decimal expected uplifts keep their exact default instead of being rounded to whole percentages', () => {
  assert.equal(promotionUpliftControl([10.25]).sliderValue, 10.25);
  assert.deepEqual(promotionUpliftControl([10.25]).applied, [10.25]);
});
