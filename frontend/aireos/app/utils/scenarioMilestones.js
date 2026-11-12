// ============================================================
// SCENARIO MILESTONES -- pure, import-free (tests/scenarioMilestones.test.mjs)
// ============================================================
//
// A building block in months that already have actual sales is a milestone:
// an event (a flood, a store closing) the user says shaped those actuals. It
// never changes a line. Its share of the actual is worked back from it: the
// actual already includes the event, so a -20% block on an actual of 2,000
// means 2,500 without it and -500 for the block. A units block counts as
// entered for each customer it covers, spread over that customer's covered
// SKU-months by their actual. Several % blocks on one SKU-month share it:
// each takes actual x p / (100 + the sum of their %).
//
// Rows are the forecast page's actuals (customer_name, product_name,
// month_year, quantity_cartons); their SKU range comes from `rangeOf`
// (product_name -> sku_range, from the forecast rows).

function covers(block, row, skuRange) {
  if (!block.isActive || block.kind === 'growth') return false;
  if (row.month_year < block.startMonth || row.month_year > block.endMonth) return false;
  if (block.customers?.length && !block.customers.includes(row.customer_name)) return false;
  if (block.skuRanges?.length && !block.skuRanges.includes(skuRange)) return false;
  if (!block.skuRanges?.length && block.sku && block.sku !== row.product_name) return false;
  const key = `${row.customer_name}|${skuRange ?? ''}`;
  return !(block.excludedPairs ?? []).some((pair) => `${pair.customer}|${pair.skuRange ?? ''}` === key);
}

/**
 * What each month's actual is made of: Map month_year -> { actual, without,
 * milestones: [{ itemId, name, units }] }, for months a milestone touches only.
 *
 * @param {object[]} actuals forecast page actuals rows
 * @param {object[]} blocks building blocks (scenarioBlocks shape)
 * @param {Record<string, string | null>} rangeOf product_name -> sku_range
 */
export function milestoneBreakdown(actuals, blocks, rangeOf) {
  const rows = actuals
    .filter((row) => row.quantity_cartons != null)
    .map((row) => ({ row, skuRange: rangeOf[row.product_name] ?? null, units: Number(row.quantity_cartons) || 0 }));
  const effects = new Map(); // row index -> [{ block, units }]
  const add = (index, block, units) => {
    if (!effects.has(index)) effects.set(index, []);
    effects.get(index).push({ block, units });
  };

  for (const block of blocks) {
    const covered = rows.map((entry, index) => ({ ...entry, index })).filter((entry) => covers(block, entry.row, entry.skuRange));
    if (!covered.length) continue;
    if (block.upliftMode === 'units') {
      for (const customer of new Set(covered.map((entry) => entry.row.customer_name))) {
        const own = covered.filter((entry) => entry.row.customer_name === customer);
        const total = own.reduce((sum, entry) => sum + entry.units, 0);
        for (const entry of own) {
          const share = total > 0 ? entry.units / total : 1 / own.length;
          add(entry.index, block, Number(block.upliftValue) * share);
        }
      }
    } else {
      for (const entry of covered) add(entry.index, block, null);
    }
  }

  const months = new Map();
  for (const [index, list] of effects) {
    const { row, units } = rows[index];
    const pctSum = list.reduce((sum, item) => sum + (item.units == null ? Number(item.block.upliftValue) : 0), 0);
    if (!months.has(row.month_year)) months.set(row.month_year, { actual: 0, without: 0, milestones: new Map() });
    const month = months.get(row.month_year);
    let taken = 0;
    for (const item of list) {
      // A % block's share of the actual; none when the %s add up to -100% or below.
      const value = item.units ?? (100 + pctSum > 0 ? (units * Number(item.block.upliftValue)) / (100 + pctSum) : 0);
      taken += value;
      const entry = month.milestones.get(item.block.id) ?? { itemId: item.block.id, name: item.block.name, units: 0 };
      entry.units += value;
      month.milestones.set(item.block.id, entry);
    }
    month.actual += units;
    month.without += units - taken;
  }
  // The SKU-months no milestone touches count in full on both sides.
  for (const { row, units } of rows) {
    const month = months.get(row.month_year);
    if (month) month.total = (month.total ?? 0) + units;
  }
  return new Map(
    [...months]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => [
        month,
        { actual: value.total, without: value.without + value.total - value.actual, milestones: [...value.milestones.values()] },
      ])
  );
}

/**
 * The Breakdown tab's "What Actual is made of": the milestone months on the
 * chart added up, each milestone once with its share over all of them.
 *
 * @param {ReturnType<typeof milestoneBreakdown>} breakdown
 */
export function milestoneTotals(breakdown) {
  const totals = { months: [...breakdown.keys()], actual: 0, without: 0, milestones: [] };
  const byItem = new Map();
  for (const month of breakdown.values()) {
    totals.actual += month.actual;
    totals.without += month.without;
    for (const item of month.milestones) {
      const entry = byItem.get(item.itemId) ?? { ...item, units: 0 };
      entry.units += item.units;
      byItem.set(item.itemId, entry);
    }
  }
  totals.milestones = [...byItem.values()];
  return totals;
}
