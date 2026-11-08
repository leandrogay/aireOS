import { matchesSearch } from './tableView.js';

// ==== SKU catalog filters ====
// The SKU page filters in the browser (it loads the whole catalog). Range and
// brand take any number of values -- an empty list means "all", the
// ui/MultiSelectDropdown rule -- and price is an optional min/max pair kept
// as the strings the inputs hold ('' = no bound).

export const EMPTY_SKU_FILTERS = { skuRanges: [], brands: [], minPrice: '', maxPrice: '' };

/**
 * Whether any filter or the search box is narrowing the list (enables Reset).
 * @param {typeof EMPTY_SKU_FILTERS} filters
 * @param {string} search
 */
export function hasSkuFilters(filters, search) {
  return (
    search.trim() !== '' ||
    filters.skuRanges.length > 0 ||
    filters.brands.length > 0 ||
    filters.minPrice !== '' ||
    filters.maxPrice !== ''
  );
}

/**
 * The SKUs that pass the search and every filter. A SKU with no current price
 * is left out once either price bound is set, since it can't be compared.
 * @param {object[]} skus
 * @param {typeof EMPTY_SKU_FILTERS} filters
 * @param {string} search
 */
export function filterSkus(skus, filters, search) {
  const { skuRanges, brands, minPrice, maxPrice } = filters;
  const priced = minPrice !== '' || maxPrice !== '';
  return skus.filter((sku) => {
    if (!matchesSearch([sku.sku, sku.sku_range, sku.product_name], search)) return false;
    if (skuRanges.length && !skuRanges.includes(sku.sku_range)) return false;
    if (brands.length && !brands.includes(sku.brand)) return false;
    if (priced && sku.price == null) return false;
    if (minPrice !== '' && Number(sku.price) < Number(minPrice)) return false;
    if (maxPrice !== '' && Number(sku.price) > Number(maxPrice)) return false;
    return true;
  });
}
