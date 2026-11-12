import test from 'node:test';
import assert from 'node:assert/strict';

import { bandLabels, breakdownTotals, compactUnits, compositionOpacity, COMPOSITION_KEYS, isSpotlightLayer, totalLabel, withComposition } from '../app/utils/scenarioComposition.js';

const ALL = Object.fromEntries(COMPOSITION_KEYS.map((key) => [key, true]));

function point(current, simulated) {
  return { month_year: '2027-06-01', current, simulated };
}

// ---- layers with no split ------------------------------------------------------

test('increases stack on Tier 0 and meet the Simulated line', () => {
  const result = withComposition(point(12400, 13760), [
    { source: 'growth', deltaUnits: 620 },
    { source: 'promotions', deltaUnits: 740 },
  ]);

  assert.equal(result.baselineLayer, 12400);
  assert.equal(result.growthLayer, 620);
  assert.equal(result.promotionsLayer, 740);
  assert.equal(result.decreaseLayer, 0);
  assert.equal(result.baselineLayer + result.growthLayer + result.promotionsLayer, result.simulated);
});

test('a decrease alone is the band from the Simulated line up to Tier 0', () => {
  const result = withComposition(point(12400, 12100), [{ source: 'blocks', deltaUnits: -300 }]);

  assert.equal(result.baselineLayer, 12100);
  assert.equal(result.decreaseLayer, 300);
});

test('a month with nothing simulated is Tier 0 alone', () => {
  const result = withComposition({ month_year: '2027-06-01', current: 500 }, []);

  assert.equal(result.baselineLayer, 500);
  assert.equal(result.breakdown.simulated, 500);
});

// ---- layers with Tier 0 split ----------------------------------------------------

test('Tier 0 is the baseline plus what it carries from last year', () => {
  const result = withComposition(point(110, 110), [], { baseline: 100, carried: 10 });

  assert.equal(result.baselineLayer, 100);
  assert.equal(result.carriedLayer, 10);
  assert.equal(result.breakdown.carried, 10);
});

test('promotions that sold less than an ordinary month are a band above Tier 0, up to the baseline', () => {
  const result = withComposition(point(334, 334), [], { baseline: 388, carried: -54 });

  assert.equal(result.baselineLayer, 334);
  assert.equal(result.carriedDownLayer, 54);
});

test('an official promotion replaces what Tier 0 carries', () => {
  // Baseline 100, carried +10, official 20% Off at +5% on the baseline.
  const result = withComposition(
    point(110, 105),
    [{ source: 'official', deltaUnits: -5, addedUnits: 5, replacedUnits: 10 }],
    { baseline: 100, carried: 10 }
  );

  assert.equal(result.carriedLayer, 0);
  assert.equal(result.officialLayer, 5);
  assert.equal(result.baselineLayer, 100);
  assert.equal(result.breakdown.official, -5);
});

test('an official promotion below the anchor is hatched above the line', () => {
  const result = withComposition(
    point(334, 372),
    [{ source: 'official', deltaUnits: 38, addedUnits: -16, replacedUnits: -54 }],
    { baseline: 388, carried: -54 }
  );

  assert.equal(result.carriedDownLayer, 0);
  assert.equal(result.officialDownLayer, 16);
  assert.equal(result.baselineLayer, 372);
});

test('a scenario promotion on top of an official one adds its own band', () => {
  const result = withComposition(
    point(110, 112),
    [
      { source: 'official', deltaUnits: -5, addedUnits: 5, replacedUnits: 10 },
      { source: 'promotions', deltaUnits: 7, addedUnits: 7, replacedUnits: 0 },
    ],
    { baseline: 100, carried: 10 }
  );

  assert.deepEqual(
    [result.baselineLayer, result.officialLayer, result.promotionsLayer],
    [100, 5, 7]
  );
});

test('the parts add up to Simulated', () => {
  const result = withComposition(
    point(110, 120),
    [
      { source: 'official', deltaUnits: -5, addedUnits: 5, replacedUnits: 10 },
      { source: 'growth', deltaUnits: 6, addedUnits: 6, replacedUnits: 0 },
      { source: 'promotions', deltaUnits: 9, addedUnits: 9, replacedUnits: 0 },
    ],
    { baseline: 100, carried: 10 }
  );
  const b = result.breakdown;

  assert.equal(b.baseline + b.carried + b.officialAdded + b.growth + b.blocks + b.promotionsAdded, 120);
});

test('the breakdown adds the months on the chart up into what the forecast holds and what is added', () => {
  const june = withComposition(
    point(110, 120),
    [
      { source: 'official', deltaUnits: -5, addedUnits: 5, replacedUnits: 10 },
      { source: 'growth', deltaUnits: 6, addedUnits: 6, replacedUnits: 0 },
      { source: 'promotions', deltaUnits: 9, addedUnits: 9, replacedUnits: 0 },
    ],
    { baseline: 100, carried: 10 }
  );
  const july = withComposition({ month_year: '2027-07-01', current: 50, simulated: 50 }, []);

  const totals = breakdownTotals(new Map([['2027-07-01', july.breakdown], ['2027-06-01', june.breakdown]]));

  assert.deepEqual(totals, {
    months: ['2027-06-01', '2027-07-01'],
    baseline: 150,
    carried: 0,
    official: 5,
    growth: 6,
    blocks: 0,
    promotions: 9,
    simulated: 170,
  });
});

// ---- labels -------------------------------------------------------------------------

test('each band is labelled with what it adds, and the baseline only when nothing is taken away', () => {
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
  const [growth] = bandLabels(result, { ...ALL, baselineLayer: false });

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

test('each adjustment keeps its own negative band so a spotlight cannot include another source', () => {
  const result = withComposition(point(100, 65), [
    { source: 'growth', deltaUnits: -5 }, { source: 'blocks', deltaUnits: -10 }, { source: 'promotions', deltaUnits: -20 },
  ]);
  assert.equal(result.growthDownLayer, 5);
  assert.equal(result.blocksDownLayer, 10);
  assert.equal(result.promotionsDownLayer, 20);
  assert.equal(result.decreaseLayer, 35);
  assert.equal(COMPOSITION_KEYS.reduce((sum, key) => sum + (result[key] ?? 0), 0), 100);
  assert.deepEqual(COMPOSITION_KEYS.filter((key) => isSpotlightLayer(key, 'blocks')), ['blocksLayer', 'blocksDownLayer']);
  assert.deepEqual(COMPOSITION_KEYS.filter((key) => isSpotlightLayer(key, 'carried')), ['carriedLayer', 'carriedDownLayer']);
});

test('spotlighting only changes opacity and keeps a selected band at its original height', () => {
  const result = withComposition(point(100, 135), [{ source: 'growth', deltaUnits: 10 }, { source: 'blocks', deltaUnits: 25 }]);
  const before = JSON.stringify(result);
  const labels = bandLabels(result, ALL);
  const focused = labels.filter((band) => isSpotlightLayer(band.key, 'blocks'));
  assert.deepEqual(focused, [{ key: 'blocksLayer', low: 110, high: 135, text: '+25' }]);
  assert.equal(compositionOpacity({ key: 'blocksLayer', opacity: 0.4 }, 'blocks'), 0.7);
  assert.equal(compositionOpacity({ key: 'growthLayer', opacity: 0.35 }, 'blocks'), 0.025);
  assert.equal(compositionOpacity({ key: 'blocksDownLayer', hatch: true }, 'blocks'), 1);
  assert.equal(compositionOpacity({ key: 'blocksLayer', opacity: 0.4 }, null), 0.4);
  assert.equal(JSON.stringify(result), before);
});
