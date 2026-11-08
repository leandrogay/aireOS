// Actual vs forecast over months picked on the sell-in plan chart
// (inventory SellInComparison). Each actual month carries its own
// SKU-matched comparison from the backend (get_sell_in_outlook's
// sell_in_vs_forecast / sell_out_vs_forecast); these add them up.

/**
 * One side (sell-in or sell-out) added up over `months`, or null when no
 * month in them could be compared.
 *
 * `source` is the forecast it was measured against: one line's key when
 * every month used the same one, else 'mixed'. `someSkusMissing` is true
 * when, in any month, some SKUs with actuals had no forecast and were left
 * out (so the actual is below the chart's).
 *
 * @param {object[]} months rows of get_sell_in_outlook's `months`
 * @param {'sell_in_vs_forecast' | 'sell_out_vs_forecast'} key
 * @returns {{ actual: number, forecast: number, difference: number, percent: number | null, source: string, someSkusMissing: boolean } | null}
 */
export function rangeComparison(months, key) {
  const compared = months.map((row) => row[key]).filter(Boolean);
  if (compared.length === 0) return null;

  let actual = 0;
  let forecast = 0;
  const sources = new Set();
  let someSkusMissing = false;
  for (const month of compared) {
    actual += month.actual;
    forecast += month.forecast;
    sources.add(month.forecast_source);
    if (month.skus_compared < month.skus_with_actuals) someSkusMissing = true;
  }
  const difference = actual - forecast;
  return {
    actual,
    forecast,
    difference,
    percent: forecast ? (difference / forecast) * 100 : null,
    source: sources.size === 1 ? [...sources][0] : 'mixed',
    someSkusMissing,
  };
}

/**
 * Each picked month on its own, sell-in and sell-out side by side, so the
 * months can be read against one another rather than as one total. Months
 * that could not be compared on either side are left out.
 *
 * @param {object[]} months rows of get_sell_in_outlook's `months`
 * @returns {{ month: string, sellIn: object | null, sellOut: object | null }[]} each side in rangeComparison's shape
 */
export function monthlyComparison(months) {
  return months
    .map((row) => ({
      month: row.month,
      sellIn: rangeComparison([row], 'sell_in_vs_forecast'),
      sellOut: rangeComparison([row], 'sell_out_vs_forecast'),
    }))
    .filter((row) => row.sellIn || row.sellOut);
}

/**
 * The picked months with no actuals yet (plan months), which a comparison of
 * actual vs forecast leaves out.
 *
 * @param {object[]} months
 * @returns {string[]} their 'YYYY-MM-DD' months
 */
export function monthsWithoutActuals(months) {
  return months
    .filter((row) => row.sell_in_actual === null && row.sell_out_actual === null)
    .map((row) => row.month);
}
