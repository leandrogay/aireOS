// Pure helpers for the Customers page (no React). The backend is the
// authority on every rule here; these mirror it so the form can flag a
// problem before anything is sent.

// ============================================================
// Names
// ============================================================

/**
 * The slug the backend stores a typed name as (see backend
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
 * Error message for a typed name, or '' when it can be saved. `takenNames`
 * holds the slugs of the other records of the same kind (the record being
 * edited is left out by the caller), so the duplicate check matches the
 * backend's case-insensitive one.
 *
 * @param {string} value
 * @param {Set<string>} takenNames
 * @param {'customer' | 'retailer'} kind
 * @returns {string}
 */
export function validateName(value, takenNames, kind) {
  const slug = normaliseName(value);
  if (!slug) return 'Enter a name.';
  if (!/^[a-z0-9_]+$/.test(slug)) return 'Use only letters, numbers, spaces, hyphens or underscores.';
  if (takenNames.has(slug)) return `A ${kind} with this name already exists.`;
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
// Same rules as backend customer_service / catalog_service: a record that
// already has data keeps its name (the dashboard, uploads and forecast look
// it up by name), and a customer is deleted only once its retailers are.
// '' means the action is allowed.
// ============================================================

/**
 * @param {{ in_use: boolean }} customer
 * @returns {string}
 */
export function customerEditBlockReason(customer) {
  return customer.in_use ? 'Has sales or inventory data' : '';
}

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
