// The Dashboard sales ranking's order (components/dashboard/SkuRanking.jsx).
// Sorted here, not by the backend: /api/sales/skus (backend
// sellout_service.get_sku_ranking) returns every SKU of the period, so a new
// sort reorders the rows already on screen -- they glide to their new places
// -- instead of fetching the ranking again.

import { customerColor } from './customerColors.js';

// Pack sizes, smallest to largest. A product name ends in one of these
// ("Aire Adult Pants S/M"), which is all the ranking rows say about size.
const SIZE_ORDER = ['XXS', 'XS', 'S', 'S/M', 'M', 'M/L', 'L', 'XL', 'XXL'];

/**
 * A product name split into its product line and the position of its size in
 * SIZE_ORDER (-1 when the name does not end in a known size).
 *
 * @param {string | null | undefined} name
 * @returns {{ line: string, sizeIndex: number }}
 */
function productNameParts(name) {
  const text = String(name ?? '').trim();
  const lastSpace = text.lastIndexOf(' ');
  const sizeIndex = lastSpace === -1 ? -1 : SIZE_ORDER.indexOf(text.slice(lastSpace + 1).toUpperCase());
  if (sizeIndex === -1) return { line: text, sizeIndex };
  return { line: text.slice(0, lastSpace), sizeIndex };
}

/**
 * Product names in shelf order: product lines A to Z, and within a line its
 * sizes smallest to largest (S/M before L before XL), not alphabetically.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareProductNames(a, b) {
  const left = productNameParts(a);
  const right = productNameParts(b);
  return (
    left.line.localeCompare(right.line) ||
    left.sizeIndex - right.sizeIndex ||
    String(a ?? '').localeCompare(String(b ?? ''))
  );
}

/**
 * `rows` sorted by `metric`: `volume` or `value` highest first unless `order`
 * is 'asc' (ties by `labelKey` A to Z), or `name`: `labelKey` compared with
 * `compareNames`, A to Z unless `order` is 'desc'. Each row gets `rank`, its
 * row number after the sort.
 *
 * @param {object[]} rows
 * @param {'volume' | 'value' | 'name'} metric
 * @param {'asc' | 'desc'} order
 * @param {string} labelKey
 * @param {(a: string, b: string) => number} compareNames
 * @returns {object[]}
 */
function rankBy(rows, metric, order, labelKey, compareNames) {
  const sorted = [...rows].sort((a, b) => {
    if (metric === 'name') {
      const byName = compareNames(String(a[labelKey] ?? ''), String(b[labelKey] ?? ''));
      return order === 'desc' ? -byName : byName;
    }
    const diff = order === 'asc' ? a[metric] - b[metric] : b[metric] - a[metric];
    if (diff !== 0) return diff;
    return String(a[labelKey] ?? '').localeCompare(String(b[labelKey] ?? ''));
  });
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * The SKU ranking rows (backend get_sku_ranking: sku, product_name, volume,
 * value, estimated_value) in the chosen order, ranked. `name` sorts by
 * product line, then size smallest to largest (compareProductNames).
 *
 * @param {object[]} skus
 * @param {'volume' | 'value' | 'name'} metric
 * @param {'asc' | 'desc'} order
 * @returns {object[]}
 */
export function rankSkus(skus, metric, order) {
  return rankBy(skus, metric, order, 'product_name', compareProductNames);
}

/**
 * One row per customer that sells through the active channel (`mode`), in
 * the chosen order, ranked. A customer with no sales in the period stays,
 * sorted as 0, so the bottom of the list is the quiet one; `hasData` false
 * means nothing is loaded for the period (backend has_data), which the table
 * shows as "No data" rather than 0.
 *
 * @param {object[]} rows backend get_customer_totals rows
 * @param {'offline' | 'online'} mode
 * @param {'volume' | 'value' | 'name'} metric
 * @param {'asc' | 'desc'} order
 * @param {{ byName: Map<string, string> }} palette from customerPalette
 * @returns {object[]}
 */
export function rankCustomers(rows, mode, metric, order, palette) {
  const shown = rows.filter((row) => (mode === 'online' ? row.has_online : row.has_offline));
  const totals = shown.map((row) => {
    const channel = row[mode] ?? { revenue: 0, units: 0 };
    return {
      customer: row.customer,
      label: row.label,
      color: customerColor(row.customer, palette),
      volume: channel.units ?? 0,
      value: channel.revenue ?? 0,
      estimatedValue: channel.estimated_revenue ?? 0,
      hasData: channel.has_data ?? true,
    };
  });
  return rankBy(totals, metric, order, 'label', (a, b) => a.localeCompare(b));
}
