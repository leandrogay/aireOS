// Shared display formatting for retailer and customer names. Retailers are
// stored as lowercase slugs (retailers.retailer_name such as
// `fairprice_online`); customers keep the capitals they were typed with
// (customers.customer_name such as `FairPrice`, `Sheng_Shiong`). Every page
// that shows one to a user formats it here so they read the same everywhere.
// No React in here.

/**
 * Display label for a stored customer name: underscores read as spaces, the
 * capitals stay as typed. `Sheng_Shiong` → `Sheng Shiong`, `NHG` → `NHG`.
 * The stored name stays the identity used for matching and API payloads;
 * only call this at render time.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function customerLabel(value) {
  if (!value) return '';
  return String(value).split(/[_\s]+/).filter(Boolean).join(' ');
}

/**
 * Display label for the customers a Scenario builder item covers:
 * `FairPrice, NHG`, or `All customers` for none (= every customer).
 *
 * @param {string[] | undefined} customers
 */
export function customersLabel(customers) {
  return customers?.length ? customers.map(customerLabel).join(', ') : 'All customers';
}

/**
 * Display label for a stored retailer name slug, e.g. `fairprice_online` →
 * `Fairprice Online`. The raw slug stays the identity used for matching and
 * API payloads; only call this at render time. Customer names use
 * customerLabel.
 *
 * Given the customer it belongs to, a customer's own channel retailer reads
 * with the customer's name as typed: `nhg_offline` under `NHG` → `NHG
 * Offline`. A retailer whose name does not match the customer (one kept
 * after a rename) keeps its own label.
 *
 * @param {string | null | undefined} value
 * @param {string} [customerName]
 * @returns {string}
 */
export function retailerLabel(value, customerName) {
  if (!value) return '';
  // Callers also pass this straight to .map(), which hands over an index
  // here, so only a string counts as a customer name.
  const channel = String(value).match(/^(.*)_(online|offline)$/);
  if (typeof customerName === 'string' && channel && channel[1] === customerName.toLowerCase()) {
    return `${customerLabel(customerName)} ${channel[2] === 'online' ? 'Online' : 'Offline'}`;
  }
  return String(value)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Display label for a mapping's vendor. Since mappings are linked to a
 * customer the vendor is the customer's name (`Sheng_Shiong` → `Sheng
 * Shiong`); one saved while customer names were lowercase slugs (`giant` →
 * `Giant`) still reads title-cased, and older free text as typed.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function vendorLabel(value) {
  if (!value) return '';
  return /^[a-z0-9_]+$/.test(value) ? retailerLabel(value) : customerLabel(value);
}
