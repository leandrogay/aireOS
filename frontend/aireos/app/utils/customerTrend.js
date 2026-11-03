// The cross-customer chart (CustomerTrendChart): each ticked customer per
// week or month, from backend get_customer_trends. Pure functions, no React.

import { customerColor } from '@/app/utils/storeFormats';
import { bucketLabel, exactBucketLabel } from '@/app/utils/trendChart';

// Most customers ticked at once (backend MAX_COMPARED_CUSTOMERS): one series
// each, and never more than storeFormats' four customer colours.
export const MAX_COMPARED_CUSTOMERS = 3;

// Up to this many periods the chart is grouped bars, one per customer in each
// period (3 customers x 6 months = 18 bars). Past it, bars get too thin to
// read, so each customer becomes a line instead.
export const MAX_BAR_PERIODS = 6;

/**
 * @param {number} periodCount
 * @returns {'bars' | 'lines'}
 */
export function trendChartKind(periodCount) {
  return periodCount > MAX_BAR_PERIODS ? 'lines' : 'bars';
}

/**
 * The customers that sell through `mode`, as chart series: dataKey is the
 * customer slug, in the colour the summary tiles and ranking give the same
 * customer (customerColor over the same labels).
 *
 * @param {Array<object>} customers get_customer_trends rows
 * @param {'offline' | 'online'} mode
 * @returns {Array<{ key: string, label: string, color: string }>}
 */
export function trendSeries(customers, mode) {
  const shown = customers.filter((customer) => (mode === 'online' ? customer.has_online : customer.has_offline));
  const labels = shown.map((customer) => customer.label);
  return shown.map((customer) => ({
    key: customer.customer,
    label: customer.label,
    color: customerColor(customer.label, labels),
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
