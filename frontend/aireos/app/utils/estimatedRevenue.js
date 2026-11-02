// The dashboard's EST sign: revenue that was filled in rather than reported.
// A sell-out row uploaded without revenue gets a promotion-priced estimate, or
// units x the catalog price (backend sellout_service EFFECTIVE_SELLOUT_CTE).
// The API sends the estimated part of every revenue figure beside it:
// `estimated_revenue` on summary and customer-total rows, `estimated_value` on
// SKU ranking rows. Pure functions, no React.

import { formatRevenue } from '@/app/utils/trendChart';

// Less than a cent is rounding, not an estimate.
const MIN_ESTIMATE = 0.01;

/**
 * @param {number | null | undefined} estimated
 * @returns {boolean} whether a figure includes estimated revenue
 */
export function hasEstimate(estimated) {
  return Number(estimated) >= MIN_ESTIMATE;
}

/**
 * The EST sign's hover text: how much is estimated.
 *
 * @param {number} estimated the estimated part
 * @param {number} total the whole figure it is part of
 * @returns {string}
 */
export function estimateNote(estimated, total) {
  const share = total > 0 ? (estimated / total) * 100 : null;
  if (share === null || share >= 99.5) return `All ${formatRevenue(estimated)} is estimated.`;
  return `${formatRevenue(estimated)} of ${formatRevenue(total)} (${share < 1 ? '<1' : Math.round(share)}%) is estimated.`;
}

/**
 * Estimated and total revenue across one channel's dashboard summary.
 *
 * @param {{ periodTotal?: Array<{ revenue: number, estimated_revenue?: number }> } | null | undefined} modeSummary
 * @returns {{ estimated: number, total: number }}
 */
export function summaryEstimate(modeSummary) {
  return (modeSummary?.periodTotal ?? []).reduce(
    (acc, row) => ({
      estimated: acc.estimated + (row.estimated_revenue ?? 0),
      total: acc.total + (row.revenue ?? 0),
    }),
    { estimated: 0, total: 0 },
  );
}

/**
 * Estimated and total revenue across every customer's figure on one channel
 * (backend get_customer_totals rows).
 *
 * @param {Array<object>} rows
 * @param {'offline' | 'online'} mode
 * @returns {{ estimated: number, total: number }}
 */
export function customersEstimate(rows, mode) {
  return (rows ?? []).reduce(
    (acc, row) => ({
      estimated: acc.estimated + (row[mode]?.estimated_revenue ?? 0),
      total: acc.total + (row[mode]?.revenue ?? 0),
    }),
    { estimated: 0, total: 0 },
  );
}

/**
 * Two estimates added together, e.g. this period and its comparison.
 *
 * @param {{ estimated: number, total: number }} a
 * @param {{ estimated: number, total: number } | null} b
 * @returns {{ estimated: number, total: number }}
 */
export function addEstimates(a, b) {
  if (!b) return a;
  return { estimated: a.estimated + b.estimated, total: a.total + b.total };
}
