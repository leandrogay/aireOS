// ============================================================
// PROMOTION UPLIFT HINTS -- the short "i" explanations, no React
// ============================================================
//
// Every hover hint on Promotion uplift settings and the Scenario builder's
// Promotions tab, kept in one place so the same idea is worded the same way
// everywhere. Plain words; the full reasoning is in docs/forecasting.md
// (Parts D and E).

export const PROMO_HINTS = {
  rule:
    'A deliberately small starting assumption (default 0.4% per point), not measured from sales. It only sets ' +
    'rule-based uplifts and the starting point of measured ones; it never changes the official forecast. One rate ' +
    'for all customers, on purpose: there is no data to give each customer a different rate, and customer ' +
    'differences are already covered by each customer’s ordinary-month discount, by measured uplifts (which ' +
    'take over as sales evidence grows), and by uplifts you type for a customer or SKU.',
  ruleRate:
    'Rule-based uplift = (promotion’s discount − the customer’s normal discount) × this rate, ' +
    'to a whole percent, kept within −90% to +300%. Above 1.0 is unusually high: check the preview.',
  anchor:
    'The discount an ordinary month already has for this customer. The forecast already includes it, so a ' +
    'promotion only adds uplift for how much deeper (or shallower) it is. Suggested from the customer’s own ' +
    'past promotions (median of the last 24 months, weighted by each store’s sales); you can type your own.',
  anchorSuggested:
    'The median of the customer’s monthly discounts over the last 24 months before this one, each store weighted ' +
    'by its share of sales. Planned future promotions are left out.',
  measured:
    'Every night, the job compares months with and without each promotion in the sales data. A SKU’s own uplift ' +
    'leans on the blended customer uplift, and the customer’s own uplift on the rule-based uplift, while their ' +
    'evidence is thin (starting weight: 3 months). Uplifts you type are never overwritten; you get a note instead.',
  notes:
    'A measured uplift differs from one somebody typed. Use measured replaces the typed uplift; Keep mine keeps it ' +
    'and asks again only if the measured uplift moves by 2 points or more.',
  upliftTable:
    'Uplift = how much more (or less, when negative) a month with this promotion sells than an ordinary month. The ' +
    'most specific uplift applies: SKU, then product range, then customer, then all customers. Pick a customer or ' +
    'SKU to list every uplift that applies to it.',
  unmapped:
    'Promotion labels in the promotions data that no uplift matches. Readable ones (like “35% Off”) get a ' +
    'rule-based uplift at the next measurement; unreadable ones are never measured.',
  discountColumn:
    'Discount per unit when the shopper takes the full deal: Buy 1 Get 1 Free = 50%, Buy 2 Get 1 Free = 33.3%.',
  upliftColumn:
    'Rule-based uplifts are shown at the ordinary-month discount of the customer picked in the filter (or the ' +
    'all-customers one); the Scenario builder works them out from each customer’s own. A capped uplift hit ' +
    'the −90% / +300% limit.',
  sourceColumn:
    'Rule-based: from the rule and the customer’s normal discount. Measured: from sales data. Estimate: typed ' +
    'by a person, never overwritten by measurement. Learned: reserved for the forecasting model.',
  // Scenario builder › Promotions
  ruleBasedTag:
    'Some uplifts here are still rule-based: a starting assumption (+0.4% per extra point of discount by default) ' +
    'until enough sales data measures them.',
  mechanic:
    'The uplift for this customer (and SKU, when one is picked) and where it came from: Rule-based, Measured ' +
    '(with its months of evidence) or Estimate. It is copied into the promotion when chosen.',
  voucher:
    'A voucher adds its own uplift on top of the mechanic: +3% until measured. It does not follow the rule, ' +
    'because a voucher has no discount percentage of its own.',
  override:
    'The reference uplift comes from Promotion uplift settings; move the slider to override it for this promotion ' +
    'only (Reset goes back). The forecast already reflects an ordinary month for the customer (its usual ' +
    'discount), so this is the change on top of that, not the promotion’s whole effect: planning the usual ' +
    'discount adds about 0%.',
  modelView:
    'Some forecast months come from Tier 1 advanced, which already includes the promotion entered for that month. ' +
    'Official forecast: promotions you plan are not added in those months, so nothing is counted twice. Plan my ' +
    'own promotions: those months use the Tier 1 basic or Tier 0 forecast instead, so you can plan them yourself; ' +
    'the grey dotted line is the official forecast.',
};

// Hints for the Evidence dialog, keyed by the labels evidenceDetails() uses.
export const EVIDENCE_HINTS = {
  'Blended SKU uplift':
    'The uplift this SKU uses: its own uplift, leaning on the blended customer uplift while its evidence is thin.',
  'Blended customer uplift':
    'The uplift this customer uses: its own uplift, leaning on the rule-based uplift while its evidence is thin.',
  "SKU's own uplift": 'What this SKU’s sales alone say, compared with its own trend line.',
  'SKU months of evidence':
    'How many months of this promotion the SKU has, counting a part-month (or part of the usual stores) as a fraction.',
  'Blended customer uplift (its starting point)': 'What the SKU leans on while its own evidence is thin.',
  "Customer's own uplift": 'The customer’s SKUs’ own uplifts, weighted by how much each SKU sells.',
  'Customer months of evidence': 'Distinct months in which any of the customer’s SKUs ran this promotion.',
  "Rule-based uplift (the customer's starting point)":
    'From the rule and the customer’s normal discount: what the customer leans on while its evidence is thin.',
  'Starting weight (k)':
    'How many months of evidence the level above counts as. With 3, a level with 3 months of its own evidence ' +
    'is weighted half and half.',
  'Backtest check':
    'How far past forecasts that knew nothing about promotions were off in months with this promotion. If it ' +
    'points the opposite way by 1 point or more, the previous uplift is kept for that run.',
  Trend:
    'Each month is compared with the SKU’s trend line, so growth isn’t mistaken for a promotion effect. Under ' +
    '6 months of history, the plain average is used instead.',
  'Data window': 'The months the forecast model learns from; the measurement uses exactly the same months.',
};

// "How this page works" on Promotion uplift settings, one short line each.
export const HOW_THIS_PAGE_WORKS = [
  'Uplift = how much more (or less) a month with a promotion sells than an ordinary month. The forecast already reflects an ordinary month.',
  'Rule-based uplifts are the starting point: a simple rule from how much deeper a promotion is than the customer’s normal discount.',
  'Measured uplifts replace them per customer and SKU once sales data has evidence (checked every night, or with Re-measure).',
  'Uplifts you type are never overwritten; when the data disagrees you get a note to Use measured or Keep mine.',
  'These uplifts are only used when planning future promotions in the Scenario builder; they never change the official forecast.',
];
