// ============================================================
// TIER 0 SPLIT -- pure, import-free (tests/scenarioTier0Split.test.mjs)
// ============================================================
//
// The Scenario builder splits each Tier 0 cell into the ordinary-month
// baseline (at the anchor) and the promotions it carries from the months it
// is built from (backend GET /api/scenario/tier0-breakdown,
// scenario/tier0_split.py). Tier 0 itself never changes: the Forecast page
// and the inventory sell-in plan keep last year's promotions.
//
// What the split changes in the Scenario builder:
//   - an official promotion planned for a month (Promotions page) replaces
//     the carried promotions there: baseline x (1 + its uplift);
//   - a scenario promotion is worked out on the baseline. Where nothing
//     official is planned it replaces the carried promotions for the share
//     of the month it runs (shares capped at the whole month); where an
//     official one is planned it is added on top.
// A cell whose split does not add up to its Tier 0 (the forecast was rerun
// since) is left unsplit: baseline = Tier 0, nothing carried, so promotions
// work on Tier 0 as before.

// A split is used only when it adds up to the cell's Tier 0 within this
// many cartons (the view rounds Tier 0 to whole cartons).
export const SPLIT_TOLERANCE_UNITS = 1;

// The Breakdown tab warns when the promotions planned move a month by more
// than this share of Tier 0.
export const BIG_CHANGE_SHARE = 0.35;

const CURRENT_UNITS = 'forecast_current';

function splitKey(customerId, sku, month) {
  return `${customerId}|${sku}|${month}`;
}

/**
 * Map customer_id|sku|month_year → split row.
 *
 * @param {{ rows: object[] } | null} data GET /api/scenario/tier0-breakdown
 */
export function tier0SplitIndex(data) {
  const index = new Map();
  for (const row of data?.rows ?? []) index.set(splitKey(row.customer_id, row.sku, row.month_year), row);
  return index;
}

/**
 * The split of one forecast row, or null when there is none or it does not
 * add up to the row's Tier 0.
 *
 * @param {Map<string, object> | null} index
 * @param {object} row forecast row (customer_id, sku, month_year, forecast_current)
 */
export function splitForRow(index, row) {
  if (!index || row[CURRENT_UNITS] == null) return null;
  const split = index.get(splitKey(row.customer_id, row.sku, row.month_year));
  if (!split || Math.abs(split.tier0 - row[CURRENT_UNITS]) > SPLIT_TOLERANCE_UNITS) return null;
  return split;
}

function cell(row, item, source, addedUnits, replacedUnits) {
  return {
    itemId: item.id,
    source,
    customer: row.customer_name,
    sku: row.product_name,
    month_year: row.month_year,
    baseUnits: row[CURRENT_UNITS],
    deltaUnits: addedUnits - replacedUnits,
    addedUnits,
    replacedUnits,
  };
}

/**
 * The official promotions' cells: in every month one is planned, the
 * baseline with its uplift in place of what Tier 0 carries.
 *
 * @param {object[]} rows forecast rows
 * @param {Map<string, object> | null} index tier0SplitIndex
 * @param {{ id: string }} item the one official-promotions item
 */
export function officialCells(rows, index, item) {
  const cells = [];
  for (const row of rows) {
    const split = splitForRow(index, row);
    if (!split?.official?.planned) continue;
    cells.push(cell(row, item, 'official', (split.baseline * split.official.uplift_pct) / 100, split.carried));
  }
  return cells;
}

/**
 * Scenario promotions' cells, every promotion over every row at once (the
 * share of the carried promotions they replace is capped per row across
 * them). `upliftFor(promotion, row)` gives the promotion's uplift % for the
 * row's product and month, already weighted by the share of the month it
 * runs; `shareFor(promotion, month)` that share. Rows with no split keep the
 * rule from before: the uplift on Tier 0.
 *
 * @param {object[]} promotions
 * @param {Map<string, object> | null} index tier0SplitIndex
 * @param {(promotion: object) => object[]} rowsFor the forecast rows one promotion covers
 * @param {(promotion: object, row: object) => number} upliftFor
 * @param {(promotion: object, month: string) => number} shareFor
 */
export function promotionCells(promotions, index, rowsFor, upliftFor, shareFor) {
  const entries = promotions.flatMap((promotion) =>
    rowsFor(promotion).map((row) => ({ promotion, row, split: splitForRow(index, row) }))
  );

  // The share of each row's month the promotions replace, together.
  const replacing = new Map();
  for (const entry of entries) {
    if (!entry.split || entry.split.official?.planned) continue;
    const key = splitKey(entry.row.customer_id, entry.row.sku, entry.row.month_year);
    replacing.set(key, (replacing.get(key) ?? 0) + shareFor(entry.promotion, entry.row.month_year));
  }

  return entries.map(({ promotion, row, split }) => {
    const base = split ? split.baseline : row[CURRENT_UNITS];
    const added = (base * upliftFor(promotion, row)) / 100;
    if (!split || split.official?.planned) return cell(row, promotion, 'promotions', added, 0);
    const total = replacing.get(splitKey(row.customer_id, row.sku, row.month_year));
    const share = shareFor(promotion, row.month_year);
    // Shares over the whole month replace the carried block once, in proportion.
    const replacedShare = total > 1 ? share / total : share;
    return cell(row, promotion, 'promotions', added, split.carried * replacedShare);
  });
}

// ============================================================
// ONE MONTH, FOR THE BREAKDOWN TAB
// ============================================================

function mechanics(sources) {
  return [...new Set(sources.flatMap((source) => (source?.promotions ?? []).map((p) => p.mechanic)))];
}

const LEVEL_ORDER = ['anchor', 'measured', 'measured_earlier', 'placeholder', 'unavailable'];

function weakest(levels) {
  const known = levels.filter(Boolean);
  if (!known.length) return null;
  return known.reduce((worst, level) => (LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(worst) ? level : worst));
}

/**
 * How one month's Tier 0 splits, totalled over the forecast rows in view:
 * Tier 0, the baseline, what it carries, which promotions ran in the months
 * it is built from and which official ones are planned. Rows with no split
 * count as all baseline (`unsplitRows`).
 *
 * @param {object[]} rows forecast rows
 * @param {Map<string, object> | null} index tier0SplitIndex
 * @param {string} month 'YYYY-MM-01'
 */
export function monthSplit(rows, index, month) {
  const monthRows = rows.filter((row) => row.month_year === month && row[CURRENT_UNITS] != null);
  const totals = {
    month,
    rowCount: monthRows.length,
    splitRows: 0,
    unsplitRows: 0,
    tier0: 0,
    runRate: 0,
    baseline: 0,
    carried: 0,
    lastYear: { month: null, units: 0, rows: 0, mechanics: [] },
    recent: [],
    official: { plannedRows: 0, mechanics: [], level: null },
    notPlannedRows: 0,
    carriedLevel: null,
  };
  const recent = new Map();
  const lastYearSources = [];
  const officialSources = [];
  const carriedLevels = [];

  for (const row of monthRows) {
    const units = Number(row[CURRENT_UNITS]);
    totals.tier0 += units;
    const split = splitForRow(index, row);
    if (!split) {
      totals.unsplitRows += 1;
      totals.baseline += units;
      continue;
    }
    totals.splitRows += 1;
    totals.runRate += split.run_rate ?? 0;
    totals.baseline += split.baseline;
    totals.carried += split.carried;
    carriedLevels.push(split.carried_level);
    if (split.last_year) {
      totals.lastYear.month = split.last_year.month;
      totals.lastYear.units += split.last_year.units;
      totals.lastYear.rows += 1;
      lastYearSources.push(split.last_year);
    }
    for (const source of split.recent ?? []) {
      if (!recent.has(source.month)) recent.set(source.month, { month: source.month, units: 0, sources: [] });
      const entry = recent.get(source.month);
      entry.units += source.units;
      entry.sources.push(source);
    }
    if (split.official?.planned) {
      totals.official.plannedRows += 1;
      officialSources.push(split.official);
    } else if (Math.abs(split.carried) >= 0.5) {
      totals.notPlannedRows += 1;
    }
  }

  totals.lastYear.mechanics = mechanics(lastYearSources);
  totals.recent = [...recent.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((entry) => ({ month: entry.month, units: entry.units, mechanics: mechanics(entry.sources) }));
  totals.official.mechanics = mechanics(officialSources);
  totals.official.level = weakest(officialSources.map((source) => source.level));
  totals.carriedLevel = weakest(carriedLevels);
  return totals;
}

/**
 * How far the promotions planned (official and scenario) move a month from
 * Tier 0, when it is more than BIG_CHANGE_SHARE: { ratio, change }, else
 * null. `change` is what replacing the carried promotions adds, in units.
 *
 * @param {number} tier0
 * @param {number} change official + scenario promotions' net units
 */
export function bigChange(tier0, change) {
  if (!tier0 || Math.abs(change) / tier0 <= BIG_CHANGE_SHARE) return null;
  return { ratio: (tier0 + change) / tier0, change };
}

// ============================================================
// THE OFFICIAL PROMOTIONS AS A SCENARIO SOURCE (scenarioSources.js)
// ============================================================

// Not saved anywhere: one built-in item that stands for every promotion
// keyed in on the Promotions page, counted whenever the split is in.
export const OFFICIAL_ITEM = { id: 'official-promotions', name: 'Official promotions' };

export const scenarioOfficialSource = {
  key: 'official',
  itemsKey: 'official',
  label: 'Official promotions',
  deltas(items, rows, view) {
    return items.length ? officialCells(rows, view?.tier0Split ?? null, items[0]) : [];
  },
  describe() {
    return {
      title: OFFICIAL_ITEM.name,
      upliftLabel: '',
      customer: '',
      sku: '',
      explanation: 'Planned on the Promotions page. In their months they replace the promotions Tier 0 carries from last year.',
      startMonth: '',
      endMonth: '',
    };
  },
};
