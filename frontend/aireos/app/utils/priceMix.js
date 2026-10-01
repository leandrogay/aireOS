// Splits a change in average selling price (revenue per unit) into the
// part from prices and the part from product mix, from per-SKU units and
// revenue for the two periods. Pure, no React.
//
// Average price is each SKU's price weighted by its share of units, so
//   avgNow − avgBefore
//     = Σ (shareNow − shareBefore) × priceBefore   ← mix: sales moved
//                                                     between SKUs
//     + Σ shareNow × (priceNow − priceBefore)       ← price: the same SKUs
//                                                     sold for more/less
// and the two parts add up exactly to the whole change. A SKU sold only
// this period has no "before" price, so it counts entirely as mix (it was
// added to the range); one sold only before drops out of the mix.

function bySku(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.volume > 0) map.set(row.sku, { units: row.volume, price: row.value / row.volume });
  }
  return map;
}

/**
 * `{ aspPct, pricePct, mixPct }` — the change in average price and its
 * price and mix parts, each as % of the earlier average price (so
 * pricePct + mixPct = aspPct). Null when either period has no units.
 *
 * @param {Array<{ sku: string, volume: number, value: number }>} currentSkus
 * @param {Array<{ sku: string, volume: number, value: number }>} baselineSkus
 */
export function priceMixEffects(currentSkus, baselineSkus) {
  const now = bySku(currentSkus);
  const before = bySku(baselineSkus);
  const unitsNow = [...now.values()].reduce((sum, s) => sum + s.units, 0);
  const unitsBefore = [...before.values()].reduce((sum, s) => sum + s.units, 0);
  if (!unitsNow || !unitsBefore) return null;

  let avgBefore = 0;
  let avgNow = 0;
  let mix = 0;
  let price = 0;
  for (const sku of new Set([...now.keys(), ...before.keys()])) {
    const n = now.get(sku);
    const b = before.get(sku);
    const shareNow = n ? n.units / unitsNow : 0;
    const shareBefore = b ? b.units / unitsBefore : 0;
    const priceBefore = b ? b.price : n.price;
    if (b) avgBefore += shareBefore * b.price;
    if (n) avgNow += shareNow * n.price;
    mix += (shareNow - shareBefore) * priceBefore;
    if (n) price += shareNow * (n.price - priceBefore);
  }

  return {
    aspPct: ((avgNow - avgBefore) / avgBefore) * 100,
    pricePct: (price / avgBefore) * 100,
    mixPct: (mix / avgBefore) * 100,
  };
}
