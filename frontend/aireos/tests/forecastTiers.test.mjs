// Which forecast model (tier) the Forecast page shows and which rows it adds
// up (app/utils/forecastTiers.js). Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_TIER,
  confidenceEntry,
  forecastModelView,
  modelOptions,
  parseTier,
  pastAccuracy,
  resolveTier,
  rowsForTier,
  tierStatus,
} from '../app/utils/forecastTiers.js';

function row(sku, tier, month, extra = {}) {
  return {
    customer_id: 1,
    customer_name: 'fairprice',
    sku,
    product_name: `Product ${sku}`,
    month_year: month,
    tier,
    forecast_current: 100,
    forecast_initial: null,
    forecast_previous: null,
    ...extra,
  };
}

const available = (hasInitial = true) => ({ is_available: true, unavailable_reason: null, has_initial: hasInitial });
const missing = (reason) => ({ is_available: false, unavailable_reason: reason, has_initial: false });

const AVAILABILITY = {
  A: { tier0: available(), tier1_basic: available(), tier1_advanced: missing('no_familiar_promotions') },
  B: { tier0: available(false), tier1_basic: missing('not_enough_history'), tier1_advanced: missing('not_enough_history') },
};

// ---- URL value ----

describe('tier from the URL', () => {
  test('a known tier is kept, anything else is Tier 0', () => {
    assert.equal(parseTier('tier1_advanced'), 'tier1_advanced');
    assert.equal(parseTier('best'), DEFAULT_TIER);
    assert.equal(parseTier(null), DEFAULT_TIER);
  });
});

// ---- Availability ----

describe('availability', () => {
  test('Tier 0 is always available', () => {
    assert.deepEqual(tierStatus({}, ['A', 'B'], 'tier0'), { available: true, reason: '' });
  });

  test('a tier is available only when every selected SKU has it', () => {
    assert.equal(tierStatus(AVAILABILITY, ['A'], 'tier1_basic').available, true);
    assert.deepEqual(tierStatus(AVAILABILITY, ['A', 'B'], 'tier1_basic'), {
      available: false,
      reason: "Not available for 1 of 2 selected SKUs · Needs 12 months of sales. Months with no sales file don't count.",
    });
  });

  test('a SKU with no entry for the tier counts as having no forecast from it', () => {
    assert.deepEqual(tierStatus({ A: { tier0: available() } }, ['A'], 'tier1_basic'), {
      available: false,
      reason: 'No forecast from this model for this product yet.',
    });
  });

  test('options keep tier order and grey out unavailable ones with the reason', () => {
    const options = modelOptions(AVAILABILITY, ['A']);
    assert.deepEqual(options.map((option) => option.value), ['tier0', 'tier1_basic', 'tier1_advanced']);
    assert.deepEqual(options.map((option) => Boolean(option.disabled)), [false, false, true]);
    assert.match(options[2].description, /^No promotion planned in the next 12 months/);
  });

  test('an unavailable tier falls back to Tier 0', () => {
    assert.equal(resolveTier('tier1_basic', AVAILABILITY, ['A']), 'tier1_basic');
    assert.equal(resolveTier('tier1_basic', AVAILABILITY, ['A', 'B']), 'tier0');
    assert.equal(resolveTier('tier1_advanced', AVAILABILITY, ['A']), 'tier0');
  });
});

// ---- Rows to add up ----

describe('rows for the chart', () => {
  const rows = [
    row('A', 'tier0', '2026-12-01', { forecast_current: 100 }),
    row('A', 'tier1_basic', '2026-12-01', { forecast_current: 140 }),
    row('A', 'tier1_advanced', '2026-12-01', { forecast_current: null }),
  ];

  test('one tier is shown, never several added together', () => {
    const view = forecastModelView({ rows, availability: AVAILABILITY, requestedTier: 'tier1_basic' });
    assert.equal(view.tier, 'tier1_basic');
    assert.deepEqual(view.rows.map((item) => item.forecast_current), [140]);
  });

  test('switching tiers switches every row to that model, with no new data', () => {
    const tier0 = forecastModelView({ rows, availability: AVAILABILITY, requestedTier: 'tier0' });
    const basic = forecastModelView({ rows, availability: AVAILABILITY, requestedTier: 'tier1_basic' });
    assert.deepEqual(tier0.rows.map((item) => item.tier), ['tier0']);
    assert.deepEqual(basic.rows.map((item) => item.tier), ['tier1_basic']);
  });

  test('the default is Tier 0', () => {
    assert.equal(forecastModelView({ rows, availability: AVAILABILITY, requestedTier: parseTier(null) }).tier, 'tier0');
  });

  test('rowsForTier keeps only that tier', () => {
    assert.equal(rowsForTier(rows, 'tier0').length, 1);
  });

  test('All customers shows the selected tier too, never an average', () => {
    const allCustomers = [
      ...rows,
      row('A', 'tier0', '2026-12-01', { customer_id: 2, customer_name: 'nhg', forecast_current: 30 }),
      row('A', 'tier1_basic', '2026-12-01', { customer_id: 2, customer_name: 'nhg', forecast_current: 50 }),
    ];
    const view = forecastModelView({ rows: allCustomers, availability: AVAILABILITY, requestedTier: 'tier1_basic' });
    assert.equal(view.tier, 'tier1_basic');
    assert.deepEqual(view.rows.map((item) => item.forecast_current), [140, 50]);
    assert.equal(view.options.find((option) => option.value === 'tier1_basic').disabled, undefined);
  });

  test('a greyed-out tier says why and the view falls back to Tier 0', () => {
    // B has too little history for Tier 1, so neither Tier 1 model is offered.
    const view = forecastModelView({
      rows: [...rows, row('B', 'tier0', '2026-12-01'), row('B', 'tier1_basic', '2026-12-01', { forecast_current: null })],
      availability: AVAILABILITY,
      requestedTier: 'tier1_basic',
    });
    assert.equal(view.tier, 'tier0');
    const basic = view.options.find((option) => option.value === 'tier1_basic');
    assert.equal(basic.disabled, true);
    assert.equal(basic.description, "Not available for 1 of 2 selected SKUs · Needs 12 months of sales. Months with no sales file don't count.");
  });
});

// ---- Confidence ----

describe('confidence', () => {
  test('past accuracy comes from the earliest month with a Current forecast', () => {
    const accuracy = pastAccuracy([
      row('A', 'tier0', '2027-01-01', { current_confidence_band: 'high', current_backtest_smape: 9 }),
      row('A', 'tier0', '2026-12-01', { current_confidence_band: 'medium', current_backtest_smape: 31.2 }),
      row('A', 'tier0', '2026-11-01', { forecast_current: null, current_confidence_band: 'low' }),
    ]);
    assert.deepEqual(accuracy, { band: 'medium', smape: 31.2 });
    assert.equal(pastAccuracy([]), null);
  });

  test('a month with no Current, Previous or Initial forecast has no confidence entry', () => {
    assert.equal(confidenceEntry(row('A', 'tier0', '2026-12-01', { forecast_current: null })), null);
  });

  test('an Initial-only month carries the plan band and range', () => {
    const entry = confidenceEntry(
      row('A', 'tier0', '2026-02-01', {
        forecast_current: null,
        forecast_initial: 2520,
        initial_confidence_band: 'low',
        initial_range_pct: 64.2,
      }),
      { initialLow: -12, initialHigh: 4060 }
    );
    assert.equal(entry.hasCurrent, false);
    assert.equal(entry.previous, null);
    // The raw lower bound is kept, even below 0.
    assert.deepEqual(entry.initial, { band: 'low', rangePct: 64.2, low: -12, high: 4060 });
  });

  test('an Initial with no usable range reads as unknown', () => {
    const entry = confidenceEntry(row('A', 'tier0', '2026-12-01', { forecast_initial: 500 }));
    assert.deepEqual(entry.initial, { band: 'unknown', rangePct: null, low: null, high: null });
  });

  test('a month with no Initial has no Initial part', () => {
    assert.equal(confidenceEntry(row('A', 'tier0', '2026-12-01')).initial, null);
  });

  test('a month with a Previous carries its own band and range', () => {
    const entry = confidenceEntry(
      row('A', 'tier0', '2026-12-01', {
        forecast_previous: 400,
        previous_confidence_band: 'medium',
        previous_range_pct: 35,
      }),
      { previousLow: 300, previousHigh: 580 }
    );
    assert.deepEqual(entry.previous, { band: 'medium', rangePct: 35, low: 300, high: 580 });
  });

  test('a Previous-only month borrows the series past accuracy', () => {
    const entry = confidenceEntry(
      row('A', 'tier0', '2026-08-01', {
        forecast_current: null,
        forecast_previous: 414,
        current_backtest_smape: null,
        current_confidence_band: null,
      }),
      { past: { band: 'medium', smape: 21 } }
    );
    assert.equal(entry.hasCurrent, false);
    assert.equal(entry.monthBand, null);
    assert.equal(entry.pastBand, 'medium');
    assert.equal(entry.smape, 21);
  });

  test('an entry is keyed by customer x SKU so All customers keeps them apart', () => {
    const entry = confidenceEntry(row('A', 'tier0', '2026-12-01', { customer_id: 2, customer_name: 'nhg' }));
    assert.equal(entry.key, '2|A');
    assert.equal(entry.customerName, 'nhg');
  });

  test('an entry keeps this month and past accuracy side by side', () => {
    const entry = confidenceEntry(
      row('A', 'tier0', '2026-12-01', {
        month_confidence_band: 'medium',
        month_range_pct: 30,
        current_confidence_band: 'high',
        current_backtest_smape: 12,
      }),
      { low: 700, high: 1300 }
    );
    assert.equal(entry.monthBand, 'medium');
    assert.equal(entry.monthRangePct, 30);
    assert.equal(entry.pastBand, 'high');
    assert.equal(entry.smape, 12);
    assert.deepEqual([entry.low, entry.high], [700, 1300]);
  });

  test('the usual-promotion note is for the Advanced tier only', () => {
    const flagged = { xreg_used_typical_promo: true };
    assert.equal(confidenceEntry(row('A', 'tier1_advanced', '2026-12-01', flagged)).typicalPromo, true);
    assert.equal(confidenceEntry(row('A', 'tier1_basic', '2026-12-01', flagged)).typicalPromo, false);
  });

  test('a missing band reads as unknown', () => {
    assert.equal(confidenceEntry(row('A', 'tier0', '2026-12-01')).monthBand, 'unknown');
  });
});
