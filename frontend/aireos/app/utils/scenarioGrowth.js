// ============================================================
// SCENARIO GROWTH -- pure, import-free (tests/scenarioGrowth.test.mjs)
// ============================================================
//
// The budget's year-on-year growth: next year = Tier 0 x (1 + g). Tier 0 has
// no growth of its own since 8 Nov 2026 (0.5 x same month last year + 0.5 x
// 3-month run-rate), so the planner sets g here, per customer.
//
// A growth is stored as a building block with kind 'growth' (backend
// migrations 016 and 024): a % block on every SKU of one customer from
// January to December, at most one per customer x year. It is
// applied exactly like a % block (scenarioGrowthSource in scenarioBlocks.js),
// added to the other blocks and promotions, never multiplied with them. It
// is edited in the Breakdown tab, never listed with the building blocks.

export const GROWTH_KIND = 'growth';

/**
 * @param {{ kind?: string }} block
 */
export function isGrowthBlock(block) {
  return block.kind === GROWTH_KIND;
}

/**
 * The calendar years the forecast months in view fall in, in order: one
 * growth row each.
 *
 * @param {string[]} months 'YYYY-MM-01' forecast months
 */
export function growthYears(months) {
  return [...new Set(months.map((month) => month.slice(0, 4)))].sort();
}

/**
 * The customer's growth block for a year, or null.
 *
 * @param {object[]} blocks growth blocks
 * @param {string} customer
 * @param {string} year 'YYYY'
 */
export function findGrowth(blocks, customer, year) {
  return blocks.find((block) => block.customers?.[0] === customer && block.startMonth === `${year}-01-01`) ?? null;
}

/**
 * The fields that make a block the growth for one customer and year: a %
 * on every SKU, January to December. Spread over newScenarioBlock().
 *
 * @param {string} customer
 * @param {string} year 'YYYY'
 */
export function growthFields(customer, year) {
  return {
    kind: GROWTH_KIND,
    // A growth names exactly one customer and covers every SKU (backend schema).
    customers: [customer],
    skuRanges: [],
    sku: '',
    name: `Growth ${year}`,
    upliftMode: 'pct',
    startMonth: `${year}-01-01`,
    endMonth: `${year}-12-01`,
  };
}

/**
 * The growth blocks to show for "All customers": every customer's growth
 * in the years in view, by customer, then year.
 *
 * @param {object[]} blocks growth blocks
 * @param {string[]} years 'YYYY'
 */
export function growthInYears(blocks, years) {
  return blocks
    .filter((block) => years.includes(block.startMonth.slice(0, 4)))
    .sort(
      (a, b) =>
        a.customers[0].localeCompare(b.customers[0]) || a.startMonth.localeCompare(b.startMonth)
    );
}
