// Development-only Scenario Builder data. Keep this shape aligned with
// forecast_service.get_forecast_view until the live Tier 0 columns exist.

const CUSTOMER = 'fairprice';
const SKU = 'Aire Ultra Tape L';
const SKU_CODE = '13271338';
const SKU_RANGE = 'Ultra Tape';
const RUN_AT = '2026-11-08T15:59:46Z';

function month(year, index) {
  return `${year}-${String(index + 1).padStart(2, '0')}-01`;
}

function row(monthYear, index) {
  const runRate = 580 + index * 8;
  const lyCartons = 490 + index * 6;
  const base = (runRate + lyCartons) / 2;
  return {
    customer_id: 1,
    customer_name: CUSTOMER,
    sku: SKU_CODE,
    product_name: SKU,
    sku_range: SKU_RANGE,
    month_year: monthYear,
    tier: 'tier0',
    tier_label: 'Tier 0 · Baseline',
    tier_order: 0,
    source_model: 'tier0_legacy',
    is_available: true,
    unavailable_reason: null,
    months_of_history: 22,
    forecast_initial: Math.round(base * 0.9),
    initial_source_model: 'initial_yearly',
    initial_generated_at: '2026-01-05T04:00:00Z',
    initial_low_80: null,
    initial_high_80: null,
    forecast_previous: Math.round(base * 0.96),
    previous_source_model: 'tier0_legacy',
    previous_generated_at: '2026-10-08T04:00:00Z',
    previous_low_80: null,
    previous_high_80: null,
    forecast_current: Math.round(base),
    current_source_model: 'tier0_legacy',
    current_generated_at: RUN_AT,
    current_low_80: Math.round(base * 0.8),
    current_high_80: Math.round(base * 1.2),
    current_backtest_smape: 28.4,
    current_confidence_band: 'medium',
    month_range_pct: 20,
    month_confidence_band: 'high',
    xreg_used_typical_promo: false,
    promo_mix: 'monthly_only',
    actual_status: 'not_yet',
    output_built_at: RUN_AT,
    tier0_latest_month: '2026-11-01',
    tier0_ly_cartons: lyCartons,
    tier0_run_rate: runRate,
    tier0_growth: null,
    tier0_base_method: 'ly+runrate',
    tier0_sell_out_base: base,
    tier0_recent_months: ['2026-09-01', '2026-10-01', '2026-11-01'],
  };
}

export const SCENARIO_FIXTURE_OPTIONS = {
  customers: [CUSTOMER],
  products: [SKU],
  sku_ranges: [SKU_RANGE],
  bounds: { start: '2026-01-01', end: '2027-12-01' },
};

export const SCENARIO_FIXTURE_ROWS = Array.from({ length: 12 }, (_, index) =>
  row(month(2027, index), index)
);

export const SCENARIO_FIXTURE_ACTUALS = Array.from({ length: 12 }, (_, index) => ({
  customer_id: 1,
  customer_name: CUSTOMER,
  sku: SKU_CODE,
  product_name: SKU,
  month_year: month(2026, index),
  quantity_cartons: 480 + index * 5,
  revenue: null,
}));

export const SCENARIO_FIXTURE_BAKED_IN_DISCOUNTS = {
  run_key: `${RUN_AT}|tier0_legacy`,
  frozen: false,
  status: 'not_frozen_yet',
  customer_name: CUSTOMER,
  // Discounts are per customer x SKU range, as promo anchors are stored.
  sku_range: SKU_RANGE,
  same_month_last_year: { mechanic: '20% off', source: 'measured' },
  recent_months: [
    { month: '2026-09-01', mechanic: '10% off', source: 'measured' },
    { month: '2026-10-01', mechanic: '15% off', source: 'anchor' },
    { month: '2026-11-01', mechanic: null, source: 'not_frozen_yet' },
  ],
};

export function scenarioFixturesEnabled() {
  return process.env.NEXT_PUBLIC_SCENARIO_FIXTURES === 'true';
}
