import test from 'node:test';
import assert from 'node:assert/strict';

import { bandLabels, compactUnits, totalLabel, withComposition } from '../app/utils/scenarioComposition.js';

const ALL = { tier0Layer: true, growthLayer: true, blocksLayer: true, promotionsLayer: true, decreaseLayer: true };

function point(current, simulated) {
  return { month_year: '2027-06-01', current, simulated };
}

// ---- layers ------------------------------------------------------------------------

test('increases stack on Tier 0 and meet the Simulated line', () => {
  const result = withComposition(point(12400, 13760), [
    { source: 'growth', deltaUnits: 620 },
    { source: 'promotions', deltaUnits: 740 },
  ]);

  assert.equal(result.tier0Layer, 12400);
  assert.equal(result.growthLayer, 620);
  assert.equal(result.promotionsLayer, 740);
  assert.equal(result.decreaseLayer, 0);
  assert.equal(result.tier0Layer + result.growthLayer + result.promotionsLayer, result.simulated);
});

test('a decrease alone is the band from the Simulated line up to Tier 0', () => {
  const result = withComposition(point(12400, 12100), [{ source: 'blocks', deltaUnits: -300 }]);

  assert.equal(result.tier0Layer, 12100);
  assert.equal(result.decreaseLayer, 300);
  assert.equal(result.tier0Layer + result.decreaseLayer, result.current);
});

test('with both, increases end on the line and the decrease sits above it', () => {
  const result = withComposition(point(12400, 12760), [
    { source: 'promotions', deltaUnits: 660 },
    { source: 'blocks', deltaUnits: -300 },
  ]);

  assert.equal(result.tier0Layer + result.promotionsLayer, 12760);
  assert.equal(result.decreaseLayer, 300);
  assert.deepEqual(result.breakdown, { tier0: 12400, growth: 0, blocks: -300, promotions: 660, simulated: 12760 });
});

test('a month with nothing simulated is Tier 0 alone', () => {
  const result = withComposition({ month_year: '2027-06-01', current: 500 }, []);

  assert.equal(result.tier0Layer, 500);
  assert.equal(result.breakdown.simulated, 500);
});

// ---- labels -------------------------------------------------------------------------

test('each band is labelled with what it adds, and Tier 0 only when nothing is taken away', () => {
  const added = withComposition(point(12400, 13020), [{ source: 'growth', deltaUnits: 620 }]);
  const mixed = withComposition(point(12400, 12760), [
    { source: 'promotions', deltaUnits: 660 },
    { source: 'blocks', deltaUnits: -300 },
  ]);

  assert.deepEqual(bandLabels(added, ALL).map((label) => label.text), ['12.4k', '+620']);
  assert.deepEqual(bandLabels(mixed, ALL).map((label) => label.text), ['+660', '−300']);
});

test('a hidden layer is not labelled and the bands above it move down', () => {
  const result = withComposition(point(12400, 13020), [{ source: 'growth', deltaUnits: 620 }]);
  const [growth] = bandLabels(result, { ...ALL, tier0Layer: false });

  assert.deepEqual(growth, { key: 'growthLayer', low: 0, high: 620, text: '+620' });
});

test('the total sits on top of whatever is drawn', () => {
  const mixed = withComposition(point(12400, 12760), [
    { source: 'promotions', deltaUnits: 660 },
    { source: 'blocks', deltaUnits: -300 },
  ]);

  assert.deepEqual(totalLabel(mixed, ALL), { value: 13060, text: '12.8k' });
});

test('tiny labels are compact', () => {
  assert.equal(compactUnits(980), '980');
  assert.equal(compactUnits(12400), '12.4k');
  assert.equal(compactUnits(20000), '20k');
  assert.equal(compactUnits(1250000), '1.3M');
});
