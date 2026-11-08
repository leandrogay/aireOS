// ==== Price range filter text ====
// Helpers for ui/PriceRangeFilter. Bounds are the inputs' strings, '' = no bound.

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });

/**
 * Text on the closed Price filter: "Any price", "$10.00 – $20.00",
 * "From $10.00" or "Up to $20.00".
 * @param {string} min
 * @param {string} max
 */
export function priceRangeSummary(min, max) {
  if (min !== '' && max !== '') return `${money.format(Number(min))} – ${money.format(Number(max))}`;
  if (min !== '') return `From ${money.format(Number(min))}`;
  if (max !== '') return `Up to ${money.format(Number(max))}`;
  return 'Any price';
}

/**
 * True when both bounds are set and min is above max, so nothing can match.
 * @param {string} min
 * @param {string} max
 */
export function isPriceRangeInverted(min, max) {
  return min !== '' && max !== '' && Number(min) > Number(max);
}
