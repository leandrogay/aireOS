// AIRE palette assigned per store format, shared by the trend chart and the
// Sell-out Summary mix bar so a format is the same colour everywhere. Reused
// across offline (4 formats) and online (1 format) since only one channel is
// ever on screen at once — safe to reuse HYPER's colour for FPON since they
// never render together. FPON previously used --aire-cream, and UNITY
// --aire-lavender; both are nearly invisible against the white card/cream
// page background, so UNITY is dusty rose, which sits with the violets.
export const FORMAT_COLORS = {
  HYPER: 'var(--aire-deep-blue)',
  SUPER: 'var(--aire-violet)',
  FINEST: 'var(--aire-celest)',
  UNITY: '#C98BA8',
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

// The original customer colours stay attached to their names, even if a new
// customer is added or an old one is removed. These are shared by every
// customer chart, summary tile and ranking.
const KNOWN_CUSTOMER_COLORS = {
  fairprice: 'var(--aire-violet)',
  nhg: '#2E7BA6',
  prime: '#8A7460',
  sheng_siong: '#C4B6A6',
  singhealth: '#C45C26',
};

const OTHER_CUSTOMER_COLORS = [
  'var(--aire-celest)',
  '#5C5299',
  '#0D9488',
  '#4F7A3A',
  '#7C3AED',
  '#E8922A',
];

// Past the palette, each customer still gets a colour of its own: this angle
// keeps successive hues far apart without ever landing on the same one twice.
const GOLDEN_ANGLE_DEGREES = 137.508;

function extraCustomerColor(position) {
  return `hsl(${(position * GOLDEN_ANGLE_DEGREES) % 360} 55% 45%)`;
}

/**
 * The order customers take colours in: by customer_id, so a new customer takes
 * the next colour and nobody else's changes. Each slot is named the way the
 * page names that customer: the dashboard passes its Customer filter options,
 * named from the sales data (`fairprice`) and linked to a customer record by
 * `customer_id` (backend get_customer_options), so a renamed record
 * ("FairPrice", "Sheng_Shiong") keeps its colour. A record no option links to
 * keeps its own name (the inventory page names customers that way). Options
 * with no customer record go last, so they can't shift anyone either.
 *
 * @param {Array<{ customer_id: number, customer_name: string }>} customers every customer (GET /api/inventory/customers)
 * @param {Array<{ value: string, customer_id?: number | null }>} [options] the page's customers, when it names them differently
 * @returns {string[]} customer names, as the page uses them
 */
export function customerColorOrder(customers, options = []) {
  const nameById = new Map(
    options.filter((option) => option.customer_id != null).map((option) => [option.customer_id, option.value]),
  );
  const byId = [...customers].sort((a, b) => a.customer_id - b.customer_id);
  const named = byId.map((customer) => nameById.get(customer.customer_id) ?? customer.customer_name);
  return [...new Set([...named, ...options.map((option) => option.value)])];
}

function customerColorKey(name) {
  return String(name ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

// One customer's colour, the same on every page. No two customers in `order`
// (customerColorOrder) share a colour, however many there are.
export function customerColor(customerName, order) {
  const key = customerColorKey(customerName);
  if (Object.hasOwn(KNOWN_CUSTOMER_COLORS, key)) return KNOWN_CUSTOMER_COLORS[key];
  const otherNames = [...new Set(order.map(customerColorKey))]
    .filter((name) => !Object.hasOwn(KNOWN_CUSTOMER_COLORS, name));
  const index = Math.max(otherNames.indexOf(key), 0);
  return OTHER_CUSTOMER_COLORS[index] ?? extraCustomerColor(index - OTHER_CUSTOMER_COLORS.length);
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
