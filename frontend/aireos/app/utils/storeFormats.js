import { customerShades } from './customerColors.js';

// The summary query uses this when a sell-out row has no store format.
const MISSING_FORMAT = 'UNKNOWN';

// One series with no format name. The chart draws it, and leaves the name
// off the legend, because there is no format to call it.
export const UNNAMED_FORMAT = 'Total';

// ==== Format colours ====

// Store formats differ by customer (HYPER / SUPER / FINEST / UNITY are
// FairPrice's), so a format has no colour of its own: one customer's formats
// are shades of that customer's colour (utils/customerColors), handed out by
// position. The biggest format by revenue takes the colour itself, the next
// the first shade, and so on, with Others always last.

/**
 * Format names in the order they take shades: this period's formats by
 * revenue, biggest first, then any found only in the comparison period, then
 * Others. Revenue whatever the chart shows, so switching Revenue / Volume
 * never swaps two formats' shades. Ties go by name, so the order is stable.
 *
 * @param {Array<{ format: string, revenue?: number }>} formats this period, after formatsToShow
 * @param {Array<{ format: string, revenue?: number }>} [baselineFormats] the comparison period, after formatsToShow
 * @returns {string[]}
 */
export function rankFormats(formats, baselineFormats = []) {
  const byRevenue = (a, b) => (b.revenue ?? 0) - (a.revenue ?? 0) || String(a.format).localeCompare(String(b.format));
  const names = [
    ...[...formats].sort(byRevenue).map((format) => format.format),
    ...[...baselineFormats].sort(byRevenue).map((format) => format.format),
  ];
  const unique = [...new Set(names)];
  return [...unique.filter((name) => name !== 'Others'), ...unique.filter((name) => name === 'Others')];
}

/**
 * Each format's colour, as a function every Dashboard part shares (trend
 * chart, comparison chart and tooltip, Sell-out Summary tiles and mix bar), so
 * one format is one shade across the page. The unnamed series (UNNAMED_FORMAT,
 * a customer with no formats) is the customer's colour. A format not in
 * `ranked` takes the shade after the last one.
 *
 * @param {string[]} ranked from rankFormats
 * @param {string} baseColor the customer's colour (customerColor)
 * @returns {(format: string) => string}
 */
export function formatShadeLookup(ranked, baseColor) {
  const shades = customerShades(baseColor, ranked.length + 1);
  return (format) => {
    if (format === UNNAMED_FORMAT) return baseColor;
    const index = ranked.indexOf(format);
    return shades[index === -1 ? ranked.length : index];
  };
}

// Named formats stay as they are. Rows with no format become one "Others"
// tile when the customer also has named formats. When every row is missing
// a format there is nothing to split, so the caller shows the total only.
export function formatsToShow(formats) {
  const named = [];
  const missing = [];
  for (const format of formats) {
    if (!format.format || format.format === MISSING_FORMAT) missing.push(format);
    else named.push(format);
  }
  if (named.length === 0) return [];
  if (missing.length === 0) return named;
  const others = missing.reduce(
    (acc, format) => ({
      revenue: acc.revenue + (format.revenue ?? 0),
      units: acc.units + (format.units ?? 0),
      estimated_revenue: acc.estimated_revenue + (format.estimated_revenue ?? 0),
    }),
    { revenue: 0, units: 0, estimated_revenue: 0 },
  );
  return [...named, { format: 'Others', ...others }];
}

// Same rule for the chart's per-period rows. `also` is the other side of a
// comparison, so a format that exists on only one side is still a named
// format. When neither side has a format, every row becomes one unnamed series.
export function relabelFormatRows(rows, also = []) {
  const hasNamed = [...rows, ...also].some((row) => row.format && row.format !== MISSING_FORMAT);
  if (!hasNamed) return rows.map((row) => ({ ...row, format: UNNAMED_FORMAT }));
  return rows.map((row) => (
    !row.format || row.format === MISSING_FORMAT ? { ...row, format: 'Others' } : row
  ));
}
