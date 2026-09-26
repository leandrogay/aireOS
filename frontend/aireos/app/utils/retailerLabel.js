// Shared display formatting for retailer and customer names. Both are stored
// as lowercase slugs (retailers.retailer_name such as `fairprice_online`,
// customers.customer_name such as `fairprice`); every page that shows one to a
// user formats it here so they read the same everywhere. No React in here.

/**
 * Display label for a stored retailer or customer name slug, e.g.
 * `fairprice_online` → `Fairprice Online`, `fairprice` → `Fairprice`. The raw
 * slug stays the identity used for matching and API payloads; only call this
 * at render time.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function retailerLabel(value) {
  if (!value) return '';
  return String(value)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
