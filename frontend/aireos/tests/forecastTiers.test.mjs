// Which forecast model (tier) the Forecast page shows and which rows it adds
// up (app/utils/forecastTiers.js). Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_TIER,
  averageAcrossTiers,
  confidenceEntry,
  forecastModelView,
  initialCoverage,
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
      reason: 'Not available for 1 of 2 selected SKUs · Needs 12+ months of sales history',
    });
  });

  test('a SKU with no entry for the tier counts as having no forecast from it', () => {
    assert.deepEqual(tierStatus({ A: { tier0: available() } }, ['A'], 'tier1_basic'), {
      available: false,
      reason: 'No forecast from this model yet',
    });
  });

  test('options keep tier order and grey out unavailable ones with the reason', () => {
    const options = modelOptions(AVAILABILITY, ['A']);
    assert.deepEqual(options.map((option) => option.value), ['tier0', 'tier1_basic', 'tier1_advanced']);
    assert.deepEqual(options.map((option) => Boolean(option.disabled)), [false, false, true]);
    assert.equal(options[2].description, 'No familiar promotions in the next 12 months');
  });

  test('an unavailable tier falls back to Tier 0', () => {
    assert.equal(resolveTier('tier1_basic', AVAILABILITY, ['A']), 'tier1_basic');
    assert.equal(resolveTier('tier1_basic', AVAILABILITY, ['A', 'B']), 'tier0');
    assert.equal(resolveTier('tier1_advanced', AVAILABILITY, ['A']), 'tier0');
  });

  test('Initial coverage counts the SKUs with any Initial on the tier', () => {
    assert.deepEqual(initialCoverage(AVAILABILITY, ['A', 'B'], 'tier0'), { withInitial: 1, total: 2 });
  });
});

// ---- Rows to add up ----

describe('rows for the chart', () => {
  const rows = [
    row('A', 'tier0', '2026-12-01', { forecast_current: 100 }),
    row('A', 'tier1_basic', '2026-12-01', { forecast_current: 140 }),
    row('A', 'tier1_advanced', '2026-12-01', { forecast_current: null }),
  ];

  test('one customer shows one tier, never several added together', () => {
    const view = forecastModelView({
      rows,
      availability: AVAILABILITY,
      requestedTier: 'tier1_basic',
      customerName: 'fairprice',
    });
    assert.equal(view.mode, 'tier');
    assert.equal(view.tier, 'tier1_basic');
    assert.deepEqual(view.rows.map((item) => item.forecast_current), [140]);
  });

  test('rowsForTier keeps only that tier', () => {
    assert.equal(rowsForTier(rows, 'tier0').length, 1);
  });

  test('All customers averages the available tiers per customer x SKU x month', () => {
    const view = forecastModelView({ rows, availability: AVAILABILITY, requestedTier: 'tier0', customerName: '' });
    assert.equal(view.mode, 'average');
    assert.equal(view.tier, null);
    assert.equal(view.rows.length, 1);
    // (100 + 140) / 2: the Advanced tier's NULL is left out, not counted as 0.
    assert.equal(view.rows[0].forecast_current, 120);
    assert.ok(view.options.every((option) => option.disabled));
  });

  test('the average keeps customers apart so they can be summed', () => {
    const averaged = averageAcrossTiers([
      row('A', 'tier0', '2026-12-01', { forecast_current: 10 }),
      row('A', 'tier0', '2026-12-01', { customer_id: 2, forecast_current: 30 }),
    ]);
    assert.deepEqual(averaged.map((item) => item.forecast_current), [10, 30]);
  });

  test('a line no tier has stays blank in the average', () => {
    const [averaged] = averageAcrossTiers([row('A', 'tier0', '2026-12-01'), row('A', 'tier1_basic', '2026-12-01')]);
    assert.equal(averaged.forecast_initial, null);
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

  test('a month with no Current forecast has no confidence entry', () => {
    assert.equal(confidenceEntry(row('A', 'tier0', '2026-12-01', { forecast_current: null })), null);
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
