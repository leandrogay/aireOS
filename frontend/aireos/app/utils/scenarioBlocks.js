// ============================================================
// SCENARIO SOURCE: BUILDING BLOCKS -- pure, no React
// ============================================================
//
// User-entered uplifts (a fair booth, new outlets, a gift with purchase) in
// the Scenario builder, or decreases (a flood, a store closing). They only
// ever move the Simulated line: the Current forecast, Inventory and
// Dashboard never read them. They are what-ifs on
// the way to the forecast pipeline's sell_out_building_blocks, which hold the
// confirmed ones that count as actuals; the two may merge in a later
// refactor, so in code these are always "scenario blocks".
//
// A block:
//   {
//     id,                           // client id, stable while the page is open
//     blockId,                      // server id, null until first saved
//     kind,                         // 'block', or 'growth' (scenarioGrowth.js); never
//                                   // changes, and every save sends it back
//     customers,                    // forecast customer_names ([] = every customer;
//                                   // a growth names exactly one), migration 022
//     skuRanges,                    // SKU ranges ([] = All SKU ranges): blocks follow ranges
//     excludedPairs,                // [{ customer, skuRange }] switched off on their own
//                                   // (skuRange null = no range); the block stays one entry
//     sku,                          // one product_name, only on blocks saved before
//                                   // ranges (backend migration 017); new blocks keep ''
//     name, explanation,            // free text; explanation is optional
//     upliftMode, upliftValue,      // 'pct' + 18 = +18% on Current each month,
//                                   // 'units' + 900 = +900 units over the whole range;
//                                   // negative = a decrease (-20 = -20%), never 0 once saved
//     decrease,                     // the Increase | Decrease switch; follows the sign
//                                   // of upliftValue, and keeps the choice while the
//                                   // units box is still empty (0)
//     startMonth, endMonth,         // 'YYYY-MM-01', forecast months only
//     isActive,                     // switched on = counts on the Simulated line
//     saved,                        // the fields as last saved, null if never saved
//   }
//
// Edits apply to the block straight away, so the chart follows the editor;
// `saved` is what Discard goes back to and what tells the list a block has
// unsaved changes.

import { customersLabel } from '@/app/utils/retailerLabel';
import { unitsDeltaCells, upliftDeltaCells } from '@/app/utils/scenarioEngine';

// Suggested as the user types a block name.
export const BLOCK_NAME_SUGGESTIONS = [
  'New Store Opening',
  'Gift With Purchase',
  'Eldercare Fair Booth',
  'Trade Marketing Push',
  'Online Marketing',
];

export const UPLIFT_MODES = [
  { value: 'pct', label: '%' },
  { value: 'units', label: 'Units' },
];
export const UPLIFT_DIRECTIONS = [
  { value: false, label: 'Increase' },
  { value: true, label: 'Decrease' },
];
// Sizes of the change, without the sign; a decrease can take a month down to
// no sales at all. Same limits as the backend's MIN_UPLIFT_PCT / MAX_UPLIFT_PCT
// (app/schemas/scenario/building_blocks.py).
export const UPLIFT_PRESETS = { increase: [5, 10, 18, 25], decrease: [10, 25, 50, 100] };
export const MAX_UPLIFT_PCT = 50;
export const MIN_UPLIFT_PCT = -100;
const DEFAULT_UPLIFT_PCT = 10;

/**
 * The largest size a % change may have in this direction: 50 up, 100 down.
 *
 * @param {boolean} decrease
 */
export function pctLimit(decrease) {
  return decrease ? -MIN_UPLIFT_PCT : MAX_UPLIFT_PCT;
}

// A size given the block's direction, as the signed value that is stored.
function signed(block, size) {
  return block.decrease ? -size : size;
}

export const NEW_BLOCK_NAME = 'New building block';

// The fields a save writes; `saved` keeps a copy of exactly these.
const SAVED_FIELDS = [
  'customers',
  'excludedPairs',
  'skuRanges',
  'sku',
  'name',
  'explanation',
  'upliftMode',
  'upliftValue',
  'startMonth',
  'endMonth',
  'isActive',
];

// skuRanges is a list; every other saved field is a primitive.
function sameField(a, b) {
  return Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? []) === JSON.stringify(b ?? []) : a === b;
}

function savedFieldsOf(block) {
  return Object.fromEntries(SAVED_FIELDS.map((field) => [field, block[field]]));
}

function newClientId() {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * A new, unsaved block for the given customers / SKU ranges, covering the
 * first forecast month. It starts switched on so it shows on the chart at once.
 *
 * @param {{ customers?: string[], skuRanges?: string[], months?: string[] }} defaults
 */
export function newScenarioBlock({ customers = [], skuRanges = [], months = [] }) {
  return {
    id: newClientId(),
    blockId: null,
    kind: 'block',
    customers,
    skuRanges,
    excludedPairs: [],
    sku: '',
    name: NEW_BLOCK_NAME,
    explanation: '',
    upliftMode: 'pct',
    upliftValue: DEFAULT_UPLIFT_PCT,
    decrease: false,
    startMonth: months[0] ?? '',
    endMonth: months[0] ?? '',
    isActive: true,
    saved: null,
  };
}

/**
 * Apply a field change to one block, keeping its date range in order: moving
 * the start past the end pulls the end along, and the other way round.
 *
 * @param {object} block
 * @param {object} changes
 */
export function updateScenarioBlock(block, changes) {
  const next = { ...block, ...changes };
  if (next.startMonth && next.endMonth && next.startMonth > next.endMonth) {
    if ('startMonth' in changes) next.endMonth = next.startMonth;
    else next.startMonth = next.endMonth;
  }
  return next;
}

/**
 * Month choices for a block's From / Until: the past months on the chart
 * (`past`: a block there is a milestone, worked back from the actual,
 * scenarioMilestones.js) and the forecast months, plus the block's own months
 * when they are neither (off the chart), so the dropdowns never show blank;
 * those are `locked`.
 *
 * @param {object} block
 * @param {string[]} months forecastMonths(rows)
 * @param {string[]} [pastMonths] months on the chart with actual sales
 */
export function blockMonthOptions(block, months, pastMonths = []) {
  const forecast = new Set(months);
  const past = new Set(pastMonths);
  const all = new Set([...pastMonths, ...months, block.startMonth, block.endMonth].filter(Boolean));
  return [...all]
    .sort()
    .map((month) => ({ month, past: past.has(month) && !forecast.has(month), locked: !forecast.has(month) && !past.has(month) }));
}

/**
 * The block switched to the other uplift mode. The value carries over as
 * its equivalent when the block's impact is known (it is on the chart), so
 * the line doesn't jump; otherwise the mode's default is used (10%, or no
 * units yet).
 *
 * @param {object} block
 * @param {'pct' | 'units'} mode
 * @param {{ baseUnits: number, deltaUnits: number } | undefined} impact simulate().byItem entry
 */
export function switchUpliftMode(block, mode, impact) {
  if (mode === block.upliftMode) return block;
  if (mode === 'units') {
    const units = impact ? Math.abs(Math.round(impact.deltaUnits)) : 0;
    return { ...block, upliftMode: mode, upliftValue: signed(block, units) };
  }
  const pct = impact?.baseUnits
    ? Math.abs(Math.round((impact.deltaUnits / impact.baseUnits) * 100))
    : DEFAULT_UPLIFT_PCT;
  const size = Math.min(pctLimit(block.decrease), Math.max(1, pct));
  return { ...block, upliftMode: mode, upliftValue: signed(block, size) };
}

/**
 * The block switched between Increase and Decrease. The size stays the same
 * (a % is brought within the new direction's limit); only the sign flips.
 *
 * @param {object} block
 * @param {boolean} decrease
 */
export function switchUpliftDirection(block, decrease) {
  if (decrease === block.decrease) return block;
  const next = { ...block, decrease };
  let size = Math.abs(Number(block.upliftValue) || 0);
  if (block.upliftMode === 'pct') size = Math.min(pctLimit(decrease), Math.max(1, size));
  return { ...next, upliftValue: signed(next, size) };
}

/**
 * What a block covers, for lists and dialogs: its SKU range, its one SKU
 * (blocks saved before ranges), or "All SKU ranges".
 *
 * @param {{ skuRanges?: string[], sku?: string }} block
 */
export function blockScopeLabel(block) {
  if (block.skuRanges?.length) return block.skuRanges.join(', ');
  return block.sku || 'All SKU ranges';
}

/**
 * "+18%", "−20%", "+900 units" or "−900 units", for the panel list and the
 * blocks table.
 *
 * @param {object} block
 */
export function upliftLabel(block) {
  const value = Number(block.upliftValue) || 0;
  const sign = value < 0 ? '−' : '+';
  if (block.upliftMode === 'units') return `${sign}${Math.abs(Math.round(value)).toLocaleString('en-US')} units`;
  return `${sign}${Math.abs(value)}%`;
}

/**
 * True when the block was never saved or differs from its saved copy.
 *
 * @param {object} block
 */
export function hasUnsavedChanges(block) {
  if (!block.saved) return true;
  return SAVED_FIELDS.some((field) => !sameField(block[field], block.saved[field]));
}

/**
 * The block as last saved, or null for a block that was never saved (Discard
 * then removes it).
 *
 * @param {object} block
 */
export function discardBlockChanges(block) {
  if (!block.saved) return null;
  return { ...block, ...block.saved, decrease: block.saved.upliftValue < 0 };
}

/**
 * The block after a successful save. The server's copy (trimmed text and
 * all) becomes the block, unless it was edited while the save was in
 * flight: those edits stay, as unsaved changes on top of the new save.
 *
 * @param {object} current the block as it is now
 * @param {object} sent the block as it was when Save was pressed
 * @param {object} savedBlock scenarioBlockFromApi of the row the save returned
 */
export function applySavedBlock(current, sent, savedBlock) {
  const editedSince = SAVED_FIELDS.some((field) => !sameField(current[field], sent[field]));
  if (editedSince) return { ...current, blockId: savedBlock.blockId, saved: savedBlock.saved };
  return { ...savedBlock, id: current.id };
}

/**
 * Field errors that stop a save, keyed by field. Empty when the block can be
 * saved.
 *
 * @param {object} block
 */
export function validateScenarioBlock(block) {
  const errors = {};
  if (!block.name.trim()) errors.name = 'Give the building block a name.';
  // No customer ticked = every customer; only a growth needs exactly one.
  if (block.kind === 'growth' && block.customers?.length !== 1) errors.customer = 'Pick one customer.';
  const value = Number(block.upliftValue) || 0;
  if (value === 0) {
    errors.upliftValue =
      block.upliftMode === 'units'
        ? `Enter how many units it ${block.decrease ? 'removes' : 'adds'}.`
        : 'Set a change above 0%.';
  } else if (block.upliftMode === 'units' && !Number.isInteger(value)) {
    errors.upliftValue = 'Enter a whole number of units.';
  } else if (block.upliftMode === 'pct' && (value < MIN_UPLIFT_PCT || value > MAX_UPLIFT_PCT)) {
    errors.upliftValue = `A % change must be between ${MIN_UPLIFT_PCT}% and +${MAX_UPLIFT_PCT}%.`;
  }
  if (!block.startMonth || !block.endMonth) errors.months = 'Pick the months it runs.';
  return errors;
}

/**
 * Request body for saving a block: backend ScenarioBuildingBlockBase
 * (app/schemas/scenario/building_blocks.py). customer_names null = every
 * customer; sku_ranges and product_name both null = All SKU ranges; product_name is only ever set on a block saved
 * before ranges. A PUT replaces every field, so `kind` always goes back as
 * it is, or a growth would turn into an ordinary block.
 *
 * @param {object} block
 */
export function buildScenarioBlockPayload(block) {
  return {
    kind: block.kind ?? 'block',
    customer_names: block.customers?.length ? block.customers : null,
    sku_ranges: block.skuRanges?.length ? block.skuRanges : null,
    excluded_pairs: (block.excludedPairs ?? []).map((pair) => ({ customer_name: pair.customer, sku_range: pair.skuRange ?? null })),
    product_name: block.skuRanges?.length ? null : block.sku || null,
    name: block.name.trim(),
    explanation: block.explanation.trim() || null,
    uplift_mode: block.upliftMode,
    uplift_value: Number(block.upliftValue),
    start_month: block.startMonth,
    end_month: block.endMonth,
    is_active: block.isActive,
  };
}

/**
 * A saved block as the page holds it, from one row the backend returns.
 * On the page `sku` holds the product name, as the forecast rows' filters do.
 *
 * @param {object} row
 */
export function scenarioBlockFromApi(row) {
  const block = {
    id: `saved-${row.block_id}`,
    blockId: row.block_id,
    kind: row.kind ?? 'block',
    customers: row.customer_names ?? [],
    skuRanges: row.sku_ranges ?? [],
    excludedPairs: (row.excluded_pairs ?? []).map((pair) => ({ customer: pair.customer_name, skuRange: pair.sku_range ?? null })),
    sku: row.product_name ?? '',
    name: row.name,
    explanation: row.explanation ?? '',
    upliftMode: row.uplift_mode,
    upliftValue: Number(row.uplift_value),
    decrease: Number(row.uplift_value) < 0,
    startMonth: row.start_month,
    endMonth: row.end_month,
    isActive: row.is_active,
  };
  return { ...block, saved: savedFieldsOf(block) };
}

/**
 * The blocks that count on the Simulated line and in the impact summary:
 * the switched-on ones, saved or not.
 *
 * @param {object[]} blocks
 */
export function activeScenarioBlocks(blocks) {
  return blocks.filter((block) => block.isActive);
}

export const scenarioBlocksSource = {
  key: 'blocks',
  itemsKey: 'blocks',
  label: 'Building block',
  deltas(blocks, rows, view) {
    return blocks.flatMap((block) =>
      block.upliftMode === 'units'
        ? unitsDeltaCells(rows, block, block.upliftValue, 'blocks', view)
        : upliftDeltaCells(rows, block, block.upliftValue, 'blocks')
    );
  },
  describe(block) {
    return {
      title: block.name || NEW_BLOCK_NAME,
      upliftLabel: upliftLabel(block),
      customer: customersLabel(block.customers),
      sku: blockScopeLabel(block),
      explanation: block.explanation,
      startMonth: block.startMonth,
      endMonth: block.endMonth,
    };
  },
};

// The budget's growth (scenarioGrowth.js): the same % maths as a block, as a
// source of its own so the chart, the hover card and the Breakdown tab can
// show it apart from the building blocks.
export const scenarioGrowthSource = {
  key: 'growth',
  itemsKey: 'growth',
  label: 'Growth',
  deltas(blocks, rows) {
    return blocks.flatMap((block) => upliftDeltaCells(rows, block, block.upliftValue, 'growth'));
  },
  describe(block) {
    return {
      title: block.name,
      upliftLabel: upliftLabel(block),
      customer: customersLabel(block.customers),
      sku: 'All SKUs',
      explanation: 'Growth on Tier 0 for every SKU, January to December.',
      startMonth: block.startMonth,
      endMonth: block.endMonth,
    };
  },
};
