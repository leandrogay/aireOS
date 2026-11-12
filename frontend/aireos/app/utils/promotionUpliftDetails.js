import { anchorLine, explanationLines } from './promoUpliftCalc.js';
import { liveUplift, liveUpliftValues } from './scenarioLiveUplifts.js';

function productsFor(promotion, resolved, kept, live) {
  const ranges = promotion.skuRanges ?? [];
  const products = new Map(Object.entries(resolved?.product_ranges ?? {}));
  for (const product of Object.keys(resolved?.product_basis ?? {})) {
    if (!products.has(product)) products.set(product, null);
  }
  for (const item of kept.referenceDetails ?? []) if (item.product_name) products.set(item.product_name, item.sku_range);
  for (const item of live) products.set(item.product, item.skuRange);
  for (const product of Object.keys(kept.referenceBySku ?? {})) {
    if (!products.has(product)) products.set(product, null);
  }
  if (promotion.sku && !ranges.length) return [[promotion.sku, products.get(promotion.sku) ?? null]];
  return [...products].filter(([, range]) => !ranges.length || ranges.includes(range));
}

function calculationLines(value, anchor) {
  if (!anchor || !value) return [];
  if (value.level === 'placeholder' && !value.placeholder) return [];
  if (['measured', 'measured_earlier'].includes(value.level) && !value.moments?.length) return [];
  return explanationLines(value, anchor);
}

/** Keep the derivation alongside the exact values copied from the calculated results. */
export function snapshotUpliftDetails(values) {
  return values.map((item) => ({
    product_name: item.product, sku_range: item.skuRange, uplift_pct: item.upliftPct, level: item.level,
    lines: calculationLines(item.value, item.anchor),
  }));
}

/** Keep the resolved rule inputs that actually produced each copied product value. */
export function resolvedUpliftDetails(resolved, promotion, kept) {
  const ranges = promotion.skuRanges ?? [];
  return productsFor(promotion, resolved, kept, []).map(([product, range]) => {
    const value = kept.referenceBySku?.[product] ?? kept.referenceUpliftPct ?? 0;
    const basis = ranges.length === 1 ? resolved?.range_basis?.[ranges[0]]?.[promotion.mechanicKey]
      : resolved?.product_basis?.[product]?.[promotion.mechanicKey];
    let lines = [];
    if (basis?.uplift_pct === value && basis.follows_anchor) {
      const signed = value < 0 ? `−${Math.abs(value)}%` : value > 0 ? `+${value}%` : '0%';
      lines = [
        anchorLine({ anchor_pct: basis.anchor_pct, mechanic_label: null, effective_from: null }),
        `Rule estimate: (${basis.discount_pct}% − ${basis.anchor_pct}%) ÷ 5 × 2 = ${signed}.`,
      ];
    }
    return { product_name: product, sku_range: range, uplift_pct: value, level: basis?.source || kept.referenceSource || 'unavailable', lines };
  });
}

function monthsBetween(first, last) {
  const months = [];
  for (let month = first; month && month <= last;) {
    months.push(month);
    const year = Number(month.slice(0, 4));
    const next = Number(month.slice(5, 7)) + 1;
    month = next === 13 ? `${year + 1}-01-01` : `${year}-${String(next).padStart(2, '0')}-01`;
  }
  return months;
}

/**
 * Expected and applied mechanic uplifts for every included customer × product,
 * grouped into consecutive months with the same derivation. Missing live values
 * use the saved value, just as the simulation does. Saved values only show their
 * saved calculation; today's settings never stand in for missing old evidence.
 */
export function promotionUpliftDetails(promotion, { liveIndex = null, upliftsByCustomer = {} } = {}) {
  const customers = promotion.customers?.length ? promotion.customers
    : [...new Set([...Object.keys(promotion.references ?? {}), ...Object.keys(upliftsByCustomer)])].sort();
  const months = monthsBetween(promotion.startMonth, promotion.endMonth);
  const rows = [];
  for (const customer of customers) {
    const kept = promotion.references?.[customer] ?? {};
    const live = liveIndex ? liveUpliftValues(liveIndex, { ...promotion, customer }) : [];
    const products = productsFor(promotion, upliftsByCustomer[customer], kept, live);
    // Old promotions can lack a product catalog. Keep their customer/range
    // reference visible without inventing individual product membership.
    const targets = products.length ? products : promotion.skuRanges?.length
      ? promotion.skuRanges.map((range) => [null, range]) : [[null, null]];
    for (const [product, skuRange] of targets) {
      if ((promotion.excludedPairs ?? []).some((pair) => pair.customer === customer && (pair.skuRange ?? null) === skuRange)) continue;
      let previous = null;
      for (const month of months) {
        const calculated = liveIndex && product ? liveUplift(liveIndex, {
          customer, mechanicKey: promotion.mechanicKey, product, month,
        }) : null;
        const expectedPct = calculated?.upliftPct ?? kept.referenceBySku?.[product] ?? kept.referenceUpliftPct ?? 0;
        const saved = (kept.referenceDetails ?? []).find((item) => item.product_name === product && item.uplift_pct === expectedPct);
        const kind = calculated ? 'live' : 'saved';
        const level = calculated?.level ?? saved?.level ?? kept.referenceSource;
        const lines = calculated ? calculationLines(calculated.value, calculated.anchor) : saved?.lines ?? [];
        const signature = JSON.stringify([expectedPct, kind, level, lines]);
        if (previous?.signature === signature) {
          previous.toMonth = month;
        } else {
          previous = { customer, product, skuRange, fromMonth: month, toMonth: month, expectedPct,
            appliedPct: promotion.overrideUpliftPct ?? expectedPct, kind, level, lines, signature };
          rows.push(previous);
        }
      }
    }
  }
  return rows;
}
