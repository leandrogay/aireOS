// ============================================================
// SCENARIO SOURCE: DRAFT PROMOTIONS -- pure, no React
// ============================================================
//
// STUB, owned by the promotions side of the Scenario builder (blueprint
// Part 5 and Part 7). It returns no cells today, so the page works without
// it; fill it in without touching the engine or the building-block files.
//
// Suggested shape of a draft promotion (agree before building):
//   {
//     id, customer, sku,                 // sku '' = all SKUs
//     promoType,                         // 'monthly' | 'side_offer' | 'bundle' | 'others'
//     mechanic,                          // from the uplift lookup table
//     referenceUpliftPct, upliftPct,     // lookup value when chosen, and the value used
//     explanation,
//     startMonth, endMonth,              // 'YYYY-MM-01', forecast months only
//   }
//
// To make promotions count, deltas() can reuse the same calculation as
// building blocks:
//   return promotions.flatMap((promo) => upliftDeltaCells(rows, promo, promo.upliftPct, 'promotions'));

export const scenarioPromotionsSource = {
  key: 'promotions',
  itemsKey: 'promotions',
  label: 'Promotion',
  deltas(promotions, rows) {
    return [];
  },
  describe(promotion) {
    return {
      title: promotion.mechanic || 'Draft promotion',
      upliftLabel: `+${promotion.upliftPct ?? 0}%`,
      customer: promotion.customer,
      sku: promotion.sku,
      explanation: promotion.explanation,
      startMonth: promotion.startMonth,
      endMonth: promotion.endMonth,
    };
  },
};

/**
 * Outlined bands for draft promotions on the chart, one per promotion:
 * { key, startMonth, endMonth, color }. ForecastChart draws them through its
 * `scenario.promoBands` prop. Stub: no bands yet.
 *
 * @param {object[]} promotions the draft's promotions
 */
export function draftPromotionBands(promotions) {
  return [];
}
