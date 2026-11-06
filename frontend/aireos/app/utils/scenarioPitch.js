// ============================================================
// SCENARIO PITCH METRICS -- pure, no React
// ============================================================
//
// The scenario's measures (blueprint Part 2.1): the seasonal average line,
// month-span labels and the impact table's rows. The summary cards and pitch
// card are gone; the Current-vs-Simulated table under the chart (by year and
// by month) carries the numbers. Everything is in units: the scenario
// predicts volume only.

import { formatMonthLabel } from '@/app/utils/forecastView';

/**
 * Seasonal average = mean of the months in view, using the actual where
 * sales have loaded and the Current forecast otherwise (blueprint Part 4.5).
 * Null when no month has a value.
 *
 * @param {object[]} points buildMonthlyPoints output for one metric
 */
export function seasonalAverage(points) {
  const values = points
    .map((point) => (point.actual != null ? point.actual : point.current))
    .filter((value) => value != null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * "Oct 26" or "Oct 26 – Dec 26" for a sorted list of month_year values.
 *
 * @param {string[]} months
 */
export function monthSpanLabel(months) {
  if (!months.length) return '—';
  const first = formatMonthLabel(months[0]);
  const last = formatMonthLabel(months[months.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * One impact-table row per counted item, across every source (blueprint
 * Part 2.3). `totals` is the item's simulate().byItem entry, or null when the item
 * is outside the rows the page fetched -- the table then shows it labelled,
 * with no numbers, and leaves it out of the "All items" total.
 *
 * @param {Record<string, object[]>} items per source, e.g. { blocks, promotions }
 * @param {object[]} sources SCENARIO_SOURCES
 * @param {Map} byItem simulate().byItem
 */
export function impactRows(items, sources, byItem) {
  return sources.flatMap((source) =>
    (items[source.itemsKey] ?? []).map((item) => ({
      key: item.id,
      sourceLabel: source.label,
      ...source.describe(item),
      totals: byItem.get(item.id) ?? null,
    }))
  );
}
