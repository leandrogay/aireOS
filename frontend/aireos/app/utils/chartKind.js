// Bars or lines for the dashboard trend chart (CustomerTrendChart and the
// single-customer FormatTrendChart), from how many bars it would draw.
// Pure and import-free, so `npm test` can run it (tests/chartKind.test.mjs).

// Most bars that still read as bars: one bar per customer in each period
// (a single customer's stacked-by-format bar counts as one). Past this the
// bars get too thin, so each series becomes a line instead. A phone has far
// less width, so its limit is much lower.
export const MAX_BARS_DESKTOP = 12;
export const MAX_BARS_MOBILE = 3;

/**
 * How many bars the chart would draw: customers drawn x periods.
 *
 * @param {number} customerCount customers drawn on the chart (1 for the single-customer chart)
 * @param {number} periodCount weeks or months on the x-axis
 * @returns {number}
 */
export function barCount(customerCount, periodCount) {
  return customerCount * periodCount;
}

/**
 * 'bars' while customers x periods is within the limit for the screen
 * (MAX_BARS_DESKTOP, or MAX_BARS_MOBILE on a phone), 'lines' past it.
 * A single period always stays bars: a line needs two points to join, so
 * one period as lines would be just a column of dots.
 *
 * @param {{ customerCount: number, periodCount: number, mobile: boolean }} options
 * @returns {'bars' | 'lines'}
 */
export function trendChartKind({ customerCount, periodCount, mobile }) {
  if (periodCount <= 1) return 'bars';
  const limit = mobile ? MAX_BARS_MOBILE : MAX_BARS_DESKTOP;
  return barCount(customerCount, periodCount) > limit ? 'lines' : 'bars';
}
