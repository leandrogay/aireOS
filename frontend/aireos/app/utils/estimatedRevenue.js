// The dashboard's est. sign: revenue that was filled in rather than reported.
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
 * The est. sign's hover text: how much is estimated.
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
