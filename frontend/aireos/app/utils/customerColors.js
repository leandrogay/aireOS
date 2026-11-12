// One colour per customer, the same on every page and chart: Dashboard,
// Inventory, Forecast, Scenario and the assistant. Pure functions, no React.
//
// The colour is decided by customer_id. Pages name a customer in different
// ways (the sales slug `sheng_siong` on the Dashboard, the record name
// `Sheng_Shiong` on Inventory and Forecast, `Sheng Siong` in the assistant),
// so a palette maps every name a page uses back to the customer_id first.
// Keying by name broke whenever two pages spelled a customer differently.

// ==== Colours ====

// Every environment shares one Cloud SQL database, so a customer_id names the
// same customer everywhere. FairPrice is a darker shade of its first colour
// (violet #A29BCC), which fell under 3:1 on the chart surface. Sheng Siong
// (gold) and Prime (olive) were two similar browns; they are now clearly apart.
const NAMED_CUSTOMER_COLORS = {
  1: '#7A70B8', // FairPrice
  16: '#9A7B00', // Sheng Siong (gold)
  21: '#2E7BA6', // NHG
  22: '#C45C26', // SingHealth
  23: '#6B8E23', // Prime (olive green)
};

// Customers without a named colour take these in customer_id order, so a new
// customer takes the next one and nobody else's changes. None is close to a
// line colour on Forecast, Scenario or the Sell-in Outlook (Current, Previous,
// Initial...), so a customer never reads as a forecast line
// (tests/customerColors.test.mjs checks the distance).
const SPARE_CUSTOMER_COLORS = ['#2D4A22', '#8E5572', '#7B2D26', '#5F0F40', '#3B2F80'];

// Past the spare colours each customer still gets a colour of its own: this
// angle keeps successive hues far apart without landing on the same one twice.
const GOLDEN_ANGLE_DEGREES = 137.508;

// The colour for a line or bar that is no one customer: All customers, a
// total across several, or a customer the page can't place.
export const NO_CUSTOMER_COLOR = 'var(--aire-deep-blue)';

function extraCustomerColor(position) {
  return `hsl(${((position * GOLDEN_ANGLE_DEGREES) % 360).toFixed(1)} 55% 45%)`;
}

/**
 * The lookup key for any spelling of a customer name: `Sheng Siong`,
 * `sheng-siong` and `SHENG_SIONG` are all `sheng_siong`.
 *
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function customerColorKey(name) {
  return String(name ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

// ==== Palette ====

/**
 * Every customer's colour, by customer_id, and by every name the page uses for
 * them. `customers` are the customer records (GET /api/inventory/customers:
 * `customer_name` as typed, `FairPrice`, `Sheng_Shiong`); `options` are the
 * Dashboard's customer options (GET /api/sales/customer-options: `value` is
 * the sales slug, linked to a record by `customer_id`, or null when no record
 * owns it). Either list alone gives the same colours for the customers in it:
 * colours are by customer_id, never by position in a list. Options with no
 * record take spare colours after every record, so they can't shift anyone.
 *
 * @param {Array<{ customer_id: number, customer_name: string }>} [customers]
 * @param {Array<{ value: string, label?: string, customer_id?: number | null }>} [options]
 * @returns {{ byId: Map<number, string>, byName: Map<string, string> }}
 */
export function customerPalette(customers = [], options = []) {
  const ids = new Set();
  for (const customer of customers) ids.add(customer.customer_id);
  for (const option of options) if (option.customer_id != null) ids.add(option.customer_id);

  const byId = new Map();
  let spare = 0;
  for (const id of [...ids].sort((a, b) => a - b)) {
    if (Object.hasOwn(NAMED_CUSTOMER_COLORS, id)) {
      byId.set(id, NAMED_CUSTOMER_COLORS[id]);
    } else {
      byId.set(id, spareColor(spare));
      spare += 1;
    }
  }

  const byName = new Map();
  for (const customer of customers) {
    byName.set(customerColorKey(customer.customer_name), byId.get(customer.customer_id));
  }
  for (const option of options) {
    if (option.customer_id != null) {
      const color = byId.get(option.customer_id);
      byName.set(customerColorKey(option.value), color);
      if (option.label) byName.set(customerColorKey(option.label), color);
    } else if (!byName.has(customerColorKey(option.value))) {
      byName.set(customerColorKey(option.value), spareColor(spare));
      spare += 1;
    }
  }
  return { byId, byName };
}

function spareColor(position) {
  return SPARE_CUSTOMER_COLORS[position] ?? extraCustomerColor(position - SPARE_CUSTOMER_COLORS.length);
}

/**
 * One customer's colour by any name a page uses for them, or NO_CUSTOMER_COLOR
 * when the palette doesn't know the name.
 *
 * @param {string | null | undefined} name
 * @param {{ byName: Map<string, string> }} palette from customerPalette
 * @returns {string}
 */
export function customerColor(name, palette) {
  return findCustomerColor(name, palette) ?? NO_CUSTOMER_COLOR;
}

/**
 * Like customerColor, but null for a name that is not a customer, so a chart
 * whose series may or may not be customers (the assistant's) keeps its own
 * colour for the rest.
 *
 * @param {string | null | undefined} name
 * @param {{ byName: Map<string, string> }} palette
 * @returns {string | null}
 */
export function findCustomerColor(name, palette) {
  if (!name) return null;
  return palette?.byName?.get(customerColorKey(name)) ?? null;
}

/**
 * One customer's colour by customer_id, or NO_CUSTOMER_COLOR.
 *
 * @param {number | null | undefined} id
 * @param {{ byId: Map<number, string> }} palette
 * @returns {string}
 */
export function customerColorById(id, palette) {
  return palette?.byId?.get(id) ?? NO_CUSTOMER_COLOR;
}

// ==== Shades ====

// How far each shade moves from the customer's colour: positive toward white,
// negative toward black. Lighter and darker alternate, so two segments side
// by side in a stack are never two near-identical tints; capped short of
// white and black so the palest still shows on the white chart panel.
const SHADE_STEPS = [0, 0.4, -0.35, 0.6, -0.55, 0.25, -0.2];

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

function mixHex(hex, target, amount) {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return `#${channels
    .map((channel) => Math.round(channel + (target - channel) * amount).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

/**
 * One shade of a colour: `amount` > 0 lighter, < 0 darker. A hex colour is
 * mixed here; anything else (a CSS variable) is left to CSS color-mix().
 *
 * @param {string} base
 * @param {number} amount -1..1
 * @returns {string}
 */
export function shadeColor(base, amount) {
  if (amount === 0) return base;
  if (HEX_COLOR.test(base)) return mixHex(base, amount > 0 ? 255 : 0, Math.abs(amount));
  const percent = Math.round(Math.abs(amount) * 100);
  return `color-mix(in srgb, ${base}, ${amount > 0 ? 'white' : 'black'} ${percent}%)`;
}

/**
 * `count` shades of one customer's colour, for the things drawn inside that
 * customer (store formats, sell-in beside sell-out). The first is the colour
 * itself; past the step list they repeat.
 *
 * @param {string} base
 * @param {number} count
 * @returns {string[]}
 */
export function customerShades(base, count) {
  return Array.from({ length: count }, (_, index) => shadeColor(base, SHADE_STEPS[index % SHADE_STEPS.length]));
}
