// AIRE palette assigned per store format, shared by the trend chart and the
// Sell-out Summary mix bar so a format is the same colour everywhere. Reused
// across offline (4 formats) and online (1 format) since only one channel is
// ever on screen at once — safe to reuse HYPER's colour for FPON since they
// never render together. FPON previously used --aire-cream, which is nearly
// invisible against the white card/cream page background.
export const FORMAT_COLORS = {
  HYPER: 'var(--aire-deep-blue)',
  SUPER: 'var(--aire-violet)',
  FINEST: 'var(--aire-celest)',
  UNITY: 'var(--aire-lavender)',
  FPON: 'var(--aire-deep-blue)',
};

// Formats the catalog doesn't know ("UNKNOWN") still get a visible colour.
export const FALLBACK_FORMAT_COLOR = 'var(--aire-violet)';

export function formatColor(format) {
  return FORMAT_COLORS[format] ?? FALLBACK_FORMAT_COLOR;
}

// The summary query uses this when a sell-out row has no store format.
const MISSING_FORMAT = 'UNKNOWN';

// One series with no format name. The chart draws it, and leaves the name
// off the legend, because there is no format to call it.
export const UNNAMED_FORMAT = 'Total';

const CUSTOMER_COLORS = [
  'var(--aire-deep-blue)',
  'var(--aire-violet)',
  'var(--aire-celest)',
  'var(--aire-lavender)',
];

// Stable colour per customer label, so the mix bar can tell them apart.
export function customerColor(label, labels) {
  const index = [...labels].sort((a, b) => a.localeCompare(b)).indexOf(label);
  return CUSTOMER_COLORS[(index < 0 ? 0 : index) % CUSTOMER_COLORS.length];
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
    }),
    { revenue: 0, units: 0 },
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
