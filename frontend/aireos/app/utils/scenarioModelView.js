// ============================================================
// SCENARIO MODEL VIEW -- pure, no React
// ============================================================
//
// Two ways to look at the forecast in the Scenario builder, so a promotion
// is never counted twice (Promotions Uplift design, Section 6.4):
//
//   'official' -- the Current forecast as the pipeline published it. In
//                 months where its model already includes the promotion
//                 entered for that month (ARIMA_PLUS_XREG), planned
//                 promotions are not added (scenarioPromotions.deltas).
//   'planned'  -- in those months, the forecast the pipeline would have
//                 picked without that model (GET /api/forecast/alternatives),
//                 so every planned promotion is added and the entered one is
//                 not already inside the number.
//
// Only the Current line changes; Actual, Initial and Previous never do.

export const MODEL_VIEWS = {
  official: 'official',
  planned: 'planned',
};

// Same value as scenarioPromotions.MODEL_INCLUDES_PROMOS.
const MODEL_INCLUDES_PROMOS = 'tier1_arimax';

// Drawn in the 'planned' view where the Current line was swapped, so the
// official number stays visible for comparison.
export const OFFICIAL_REFERENCE_SERIES = {
  key: 'officialCurrent',
  label: 'Official forecast',
  color: '#9AA0B4',
  dash: '2 3',
  shape: 'circle',
  connectNulls: false,
};

function rowKey(row) {
  return `${row.customer_name}|${row.product_name}|${row.month_year}`;
}

/**
 * How many forecast SKU-months already include an entered promotion (Tier 1
 * advanced), out of all forecast SKU-months, and which months they are --
 * the counts the view toggle shows.
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 * @returns {{ modelMonths: number, totalMonths: number, months: string[] }}
 */
export function modelPromotionSummary(rows) {
  const forecastRows = rows.filter((row) => row.forecast_current != null);
  const modelRows = forecastRows.filter((row) => row.current_source_model === MODEL_INCLUDES_PROMOS);
  return {
    modelMonths: modelRows.length,
    totalMonths: forecastRows.length,
    months: [...new Set(modelRows.map((row) => row.month_year))].sort(),
  };
}

/**
 * The forecast rows for a view. 'official' returns them as they are;
 * 'planned' swaps the Current figures of every matching alternative in,
 * keeping the official ones as official_forecast_current(_revenue).
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 * @param {object[]} alternatives rows from GET /api/forecast/alternatives
 * @param {'official' | 'planned'} view
 */
export function rowsForView(rows, alternatives, view) {
  if (view !== MODEL_VIEWS.planned || !alternatives.length) return rows;

  const byKey = new Map(alternatives.map((alt) => [rowKey(alt), alt]));
  return rows.map((row) => {
    const alt = row.current_source_model === MODEL_INCLUDES_PROMOS ? byKey.get(rowKey(row)) : null;
    if (!alt) return row;
    return {
      ...row,
      official_forecast_current: row.forecast_current,
      official_forecast_current_revenue: row.forecast_current_revenue ?? null,
      forecast_current: alt.alt_forecast_current,
      forecast_current_revenue: alt.alt_forecast_current_revenue,
      current_low_80: alt.alt_low_80,
      current_low_80_revenue: alt.alt_low_80_revenue,
      current_high_80: alt.alt_high_80,
      current_high_80_revenue: alt.alt_high_80_revenue,
      current_source_model: alt.alt_source_model,
      current_backtest_smape: alt.alt_backtest_smape,
    };
  });
}

/**
 * Chart points with the official Current value added as `officialCurrent`
 * in the months where the view changed it (null elsewhere, so the reference
 * line only appears where the two differ).
 *
 * @param {object[]} points chart points built from the view's rows
 * @param {object[]} officialPoints the same points built from the official rows
 */
export function withOfficialReference(points, officialPoints) {
  const official = new Map(officialPoints.map((point) => [point.month_year, point.current]));
  return points.map((point) => {
    const value = official.get(point.month_year);
    const differs = value != null && point.current != null && Math.abs(value - point.current) > 1e-9;
    return { ...point, officialCurrent: differs ? value : null };
  });
}
