// Pure helpers for the Customers page (no React). The backend is the
// authority on every rule here; these mirror it so the form can flag a
// problem before anything is sent.

// ============================================================
// Names
// ============================================================

/**
 * The slug the backend stores a typed retailer name as (see backend
 * schemas.catalog.normalise_name): lowercase, runs of spaces / hyphens
 * become one underscore. `Giant Online` → `giant_online`.
 *
 * @param {string} value
 * @returns {string}
 */
export function normaliseName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * The name the backend stores a typed customer name as (see backend
 * schemas.catalog.clean_customer_name): the capitals as typed, runs of
 * spaces / hyphens become one underscore. `Sheng Shiong` → `Sheng_Shiong`,
 * `FairPrice` stays `FairPrice`.
 *
 * @param {string} value
 * @returns {string}
 */
export function cleanCustomerName(value) {
  return String(value ?? '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * How a typed name of either kind is stored.
 *
 * @param {string} value
 * @param {'customer' | 'retailer'} kind
 * @returns {string}
 */
export function storedName(value, kind) {
  return kind === 'customer' ? cleanCustomerName(value) : normaliseName(value);
}

/**
 * Error message for a typed name, or '' when it can be saved. `takenNames`
 * holds the lowercase slugs (normaliseName) of the other records of the same
 * kind (the record being edited is left out by the caller), so the duplicate
 * check matches the backend's case-insensitive one: `NHG` is taken by `nhg`.
 *
 * @param {string} value
 * @param {Set<string>} takenNames
 * @param {'customer' | 'retailer'} kind
 * @returns {string}
 */
export function validateName(value, takenNames, kind) {
  const name = storedName(value, kind);
  if (!name) return 'Enter a name.';
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Use only letters, numbers, spaces, hyphens or underscores.';
  if (takenNames.has(name.toLowerCase())) return `A ${kind} with this name already exists.`;
  return '';
}

/**
 * Slugs of every retailer on the page, linked or not: retailer names are
 * unique across all customers.
 *
 * @param {object[]} customers
 * @param {object[]} unlinked
 * @returns {string[]}
 */
export function allRetailerNames(customers, unlinked) {
  return [
    ...customers.flatMap((customer) => customer.retailers.map((retailer) => retailer.retailer_name)),
    ...unlinked.map((retailer) => retailer.retailer_name),
  ];
}

// ============================================================
// Why a record cannot be edited or deleted
//
// Same rules as backend customer_service / catalog_service: a retailer
// that already has data keeps its name (the dashboard, uploads and
// promotions look it up by name), and a customer is deleted only once its
// retailers are. A customer can always be renamed: everything links to it
// by id. '' means the action is allowed.
// ============================================================

/**
 * @param {{ in_use: boolean, retailers: object[] }} customer
 * @returns {string}
 */
export function customerDeleteBlockReason(customer) {
  if (customer.in_use) return 'Has sales or inventory data';
  if (customer.retailers.length) return 'Delete its retailers first';
  return '';
}

/**
 * Edit and delete share one rule for a retailer.
 *
 * @param {{ in_use: boolean }} retailer
 * @returns {string}
 */
export function retailerBlockReason(retailer) {
  return retailer.in_use ? 'Has stores, sales or promotions' : '';
}
