// The cross-customer chart (CustomerTrendChart): each ticked customer per
// week or month, from backend get_customer_trends. Pure functions, no React.

import { customerColor } from '@/app/utils/customerColors';
import { bucketLabel, exactBucketLabel } from '@/app/utils/trendChart';

// Any number of customers can be ticked; bars or lines is decided from
// customers x periods in utils/chartKind.js.

/**
 * The customers that sell through `mode`, as chart series: dataKey is the
 * customer slug, in the colour that customer has on every page (customerColor).
 *
 * @param {Array<object>} customers get_customer_trends rows
 * @param {'offline' | 'online'} mode
 * @param {{ byName: Map<string, string> }} palette from customerPalette
 * @returns {Array<{ key: string, label: string, color: string }>}
 */
export function trendSeries(customers, mode, palette) {
  const shown = customers.filter((customer) => (mode === 'online' ? customer.has_online : customer.has_offline));
  return shown.map((customer) => ({
    key: customer.customer,
    label: customer.label,
    color: customerColor(customer.customer, palette),
  }));
}

/**
 * One chart row per period, in date order, with each series' figure under its
 * key and its estimated revenue under `${key}Estimated`, for the tooltip. A
 * customer with no sales loaded for a period has null there, not 0: its line
 * starts where its data does instead of running along zero before it.
 *
 * @param {Array<object>} customers get_customer_trends rows
 * @param {Array<{ key: string }>} series from trendSeries
 * @param {'offline' | 'online'} mode
 * @param {'revenue' | 'units'} metric
 * @param {'week' | 'month'} granularity
 * @returns {Array<object>}
 */
export function trendRows(customers, series, mode, metric, granularity) {
  const byPeriod = new Map();
  for (const { key } of series) {
    const customer = customers.find((row) => row.customer === key);
    for (const period of customer?.[mode] ?? []) {
      if (!byPeriod.has(period.period_label)) {
        byPeriod.set(period.period_label, {
          periodStart: period.period_start,
          displayLabel: bucketLabel(granularity, period.period_start),
          exactLabel: exactBucketLabel(granularity, period.period_start),
        });
      }
      const row = byPeriod.get(period.period_label);
      row[key] = period[metric] ?? 0;
      row[`${key}Estimated`] = metric === 'revenue' ? (period.estimated_revenue ?? 0) : 0;
    }
  }
  const rows = [...byPeriod.values()].sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart)));
  for (const row of rows) {
    for (const { key } of series) {
      row[key] ??= null;
      row[`${key}Estimated`] ??= 0;
    }
  }
  return rows;
}
