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

/**
 * Frozen budget totals in the requested scope, including months the rolling
 * forecast no longer reaches, as `key` on each point (the Budget line's
 * 'budget', or a compared version's key).
 */
export function withBudgetPoints(points, rows, scope = {}, makePoint = (month) => ({ month_year: month }), key = 'budget') {
  const totals = new Map();
  for (const row of rows) {
    if (scope.customerName && scope.customerName !== row.customer_name) continue;
    if (scope.productName && scope.productName !== row.product_name) continue;
    if (scope.skuRange && scope.skuRange !== row.sku_range) continue;
    if (scope.startDate && row.month_year < scope.startDate.slice(0, 7) + '-01') continue;
    if (scope.endDate && row.month_year > scope.endDate) continue;
    totals.set(row.month_year, (totals.get(row.month_year) ?? 0) + row.units);
  }
  const merged = new Map(points.map((point) => [point.month_year, { ...point, [key]: null }]));
  for (const [month, units] of totals) merged.set(month, { ...(merged.get(month) ?? makePoint(month)), [key]: units });
  return [...merged.values()].sort((a, b) => a.month_year.localeCompare(b.month_year));
}

// At most this many locked versions are compared on the Budget planning
// chart at once. They share the Budget colour and differ by dash and marker,
// so they read as budgets beside the draft's Simulated line.
export const MAX_COMPARED_VERSIONS = 3;
const VERSION_STYLES = [
  { dash: '12 3 2 3', shape: 'square' },
  { dash: '6 4', shape: 'triangle' },
  { dash: '2 3', shape: 'circle' },
];

/** The chart key of a compared locked version. */
export function budgetVersionKey(version) {
  return `budget_v${version}`;
}

/** A version's name as the history and the legend show it: "Version 2 · Base case". */
export function budgetVersionLabel(item) {
  return `Version ${item.version}${item.name ? ` · ${item.name}` : ''}`;
}

/**
 * The chart series of compared versions, in the order picked.
 *
 * @param {{ version: number, name?: string | null }[]} items history entries
 */
export function budgetVersionSeries(items) {
  return items.slice(0, MAX_COMPARED_VERSIONS).map((item, index) => ({
    key: budgetVersionKey(item.version), label: budgetVersionLabel(item), color: BUDGET_COLORS.sellOut,
    connectNulls: false, ...VERSION_STYLES[index],
  }));
}

/**
 * The years Budget planning offers: this year and next, those with an
 * Initial Yearly Forecast (initial-status `forecast_year`s). Next year's
 * appears from about September; with no status (a failed read) both are offered.
 *
 * @param {{ forecast_year: number | string }[]} initialStatus
 * @param {number} thisYear
 */
export function budgetYears(initialStatus, thisYear) {
  const candidates = [thisYear, thisYear + 1];
  const known = new Set((initialStatus ?? []).map((item) => Number(item.forecast_year)));
  const available = candidates.filter((year) => known.has(year));
  return available.length ? available : candidates;
}
