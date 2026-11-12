export const BUDGET_COLORS = { sellIn: '#5A6B21', sellOut: '#A61E4D' };

export const BUDGET_SERIES = {
  key: 'budget', label: 'Budget', color: BUDGET_COLORS.sellOut, dash: '12 3 2 3', shape: 'square', connectNulls: false,
};

/** The Initial Yearly Forecast as a plain simulation base, with no actuals or confidence claims. */
export function initialBudgetRows(rows) {
  return rows.filter((row) => row.forecast_initial != null).map((row) => ({
    ...row, forecast_current: row.forecast_initial, forecast_previous: null,
    actual_status: 'not_yet', current_low_80: null, current_high_80: null,
    current_confidence_band: null, month_confidence_band: null,
  }));
}

/** Refuse a Budget preview when its split and the displayed Initial are from different reads. */
export function initialSplitProblem(data, rows) {
  if (data.basis !== 'initial') return 'The budget needs the Initial breakdown at its own data cut-off.';
  if (data.unavailable?.length) return `Initial breakdown unavailable: ${data.unavailable[0].reason}`;
  const index = new Map((data.rows ?? []).map((row) => [`${row.customer_id}|${row.sku}|${row.month_year}`, row]));
  for (const row of rows) {
    const split = index.get(`${row.customer_id}|${row.sku}|${row.month_year}`);
    if (!split || ![split.tier0, split.baseline, split.carried].every(Number.isFinite)
      || Math.abs(split.tier0 - row.forecast_initial) > 0.000001
      || Math.abs(split.baseline + split.carried - row.forecast_initial) > 0.000001) {
      return 'Initial and its breakdown do not match. Reload before previewing or locking this budget.';
    }
  }
  return null;
}

/** Frozen budget totals in the requested scope, including months the rolling forecast no longer reaches. */
export function withBudgetPoints(points, rows, scope = {}, makePoint = (month) => ({ month_year: month })) {
  const totals = new Map();
  for (const row of rows) {
    if (scope.customerName && scope.customerName !== row.customer_name) continue;
    if (scope.productName && scope.productName !== row.product_name) continue;
    if (scope.skuRange && scope.skuRange !== row.sku_range) continue;
    if (scope.startDate && row.month_year < scope.startDate.slice(0, 7) + '-01') continue;
    if (scope.endDate && row.month_year > scope.endDate) continue;
    totals.set(row.month_year, (totals.get(row.month_year) ?? 0) + row.units);
  }
  const merged = new Map(points.map((point) => [point.month_year, { ...point, budget: null }]));
  for (const [month, units] of totals) merged.set(month, { ...(merged.get(month) ?? makePoint(month)), budget: units });
  return [...merged.values()].sort((a, b) => a.month_year.localeCompare(b.month_year));
}
