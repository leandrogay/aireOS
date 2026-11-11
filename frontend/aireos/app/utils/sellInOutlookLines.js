// Pure helper for the sell-in plan chart (SellInOutlookChart). Import-free so
// `npm test` (node --test) can check it without a browser.

const ON_CURRENT_FORECAST = ['current', 'mixed'];

function isOnCurrent(row) {
  return ON_CURRENT_FORECAST.includes(row?.forecast_source);
}

/**
 * The values of the Current lines and the overlay's lines that adjust them,
 * one entry per month. They start at the last actual month, as that month's
 * actual, so each reads as one stroke from actual into plan -- but only while
 * that actual line is shown (`joinSellIn` / `joinSellOut`). With it hidden the
 * joined point would read as a forecast value the tooltip doesn't list, so the
 * line starts at its first forecast month instead.
 *
 * Before that month they are empty. A SKU that stopped early (no sell-in
 * entered lately) still has plan rows in those months, but they are that one
 * SKU's plan set against every other SKU's actuals, and would draw as a point
 * near 0.
 *
 * @param {Array<{ month: string, forecast_source: string | null, sell_in_actual: number | null, sell_out_actual: number | null, sell_in_recommended: number | null, sell_out_forecast: number | null, sell_in_with_blocks?: number | null, sell_out_with_blocks?: number | null }>} months
 * @param {string | null} actualsThrough the last actual month
 * @param {{ joinSellIn?: boolean, joinSellOut?: boolean }} [options] whether the Sell-in / Sell-out (actual) line is shown
 * @returns {Array<{ sell_in_recommended: number | null, sell_out_current: number | null, sell_in_with_blocks: number | null, sell_out_with_blocks: number | null }>}
 */
export function currentLineValues(months, actualsThrough, { joinSellIn = true, joinSellOut = true } = {}) {
  const lastIndex = months.findIndex((row) => row.month === actualsThrough);
  const next = months[lastIndex + 1];

  return months.map((row, index) => {
    if (index < lastIndex) {
      return { sell_in_recommended: null, sell_out_current: null, sell_in_with_blocks: null, sell_out_with_blocks: null };
    }
    if (index === lastIndex) {
      const sellIn = joinSellIn ? row.sell_in_actual : null;
      const sellOut = joinSellOut && isOnCurrent(next) ? row.sell_out_actual : null;
      return {
        sell_in_recommended: next?.sell_in_recommended != null ? sellIn : null,
        sell_out_current: sellOut,
        sell_in_with_blocks: next?.sell_in_with_blocks != null ? sellIn : null,
        sell_out_with_blocks: sellOut,
      };
    }
    return {
      sell_in_recommended: row.sell_in_recommended,
      sell_out_current: isOnCurrent(row) ? row.sell_out_forecast : null,
      sell_in_with_blocks: row.sell_in_with_blocks ?? null,
      sell_out_with_blocks: isOnCurrent(row) ? (row.sell_out_with_blocks ?? null) : null,
    };
  });
}
