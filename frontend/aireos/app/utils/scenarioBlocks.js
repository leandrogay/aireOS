// ============================================================
// SCENARIO SOURCE: BUILDING BLOCKS -- pure, no React
// ============================================================
//
// User-entered uplifts (a fair booth, new outlets, a gift with purchase) in
// the Scenario builder. They only ever move the Simulated line: the Current
// forecast, Inventory and Dashboard never read them. They are what-ifs on
// the way to the forecast pipeline's sell_out_building_blocks, which hold the
// confirmed ones that count as actuals; the two may merge in a later
// refactor, so in code these are always "scenario blocks".
//
// A block:
//   {
//     id,                           // client id, stable while the page is open
//     blockId,                      // server id, null until first saved
//     customer, sku,                // forecast customer_name / product_name; sku '' = all SKUs
//     name, explanation,            // free text; explanation is optional
//     upliftMode, upliftValue,      // 'pct' + 18 = +18% on Current each month,
//                                   // 'units' + 900 = +900 units over the whole range
//     startMonth, endMonth,         // 'YYYY-MM-01', forecast months only
//     isActive,                     // switched on = counts on the Simulated line
//     saved,                        // the fields as last saved, null if never saved
//   }
//
// Edits apply to the block straight away, so the chart follows the editor;
// `saved` is what Discard goes back to and what tells the list a block has
// unsaved changes.

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
  { value: 'pct', label: '% uplift' },
  { value: 'units', label: 'Units' },
];
export const UPLIFT_PRESETS = [5, 10, 18, 25];
export const MAX_UPLIFT_PCT = 50;
const DEFAULT_UPLIFT_PCT = 10;

export const NEW_BLOCK_NAME = 'New building block';

// The fields a save writes; `saved` keeps a copy of exactly these.
const SAVED_FIELDS = [
  'customer',
  'sku',
  'name',
  'explanation',
  'upliftMode',
  'upliftValue',
  'startMonth',
  'endMonth',
  'isActive',
];

function savedFieldsOf(block) {
  return Object.fromEntries(SAVED_FIELDS.map((field) => [field, block[field]]));
}

function newClientId() {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * A new, unsaved block for the given customer/SKU, covering the first
 * forecast month. It starts switched on so it shows on the chart at once.
 *
 * @param {{ customer: string, sku: string, months: string[] }} defaults
 */
export function newScenarioBlock({ customer = '', sku = '', months = [] }) {
  return {
    id: newClientId(),
    blockId: null,
    customer,
    sku,
    name: NEW_BLOCK_NAME,
    explanation: '',
    upliftMode: 'pct',
    upliftValue: DEFAULT_UPLIFT_PCT,
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
 * Month choices for a block's From / Until: the forecast months, plus the
 * block's own months if they have since had actuals loaded (a saved Oct-Dec
 * block once October closes), so the dropdowns never show blank. Those
 * months are `locked`: they stay as saved but no longer change the line.
 *
 * @param {object} block
 * @param {string[]} months forecastMonths(rows)
 */
export function blockMonthOptions(block, months) {
  const open = new Set(months);
  const all = new Set([...months, block.startMonth, block.endMonth].filter(Boolean));
  return [...all].sort().map((month) => ({ month, locked: !open.has(month) }));
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
    const units = impact ? Math.round(impact.deltaUnits) : 0;
    return { ...block, upliftMode: mode, upliftValue: units };
  }
  const pct = impact?.baseUnits ? Math.round((impact.deltaUnits / impact.baseUnits) * 100) : DEFAULT_UPLIFT_PCT;
  return { ...block, upliftMode: mode, upliftValue: Math.min(MAX_UPLIFT_PCT, Math.max(1, pct)) };
}

/**
 * "+18%" or "+900 units", for the list, impact table and pitch summary.
 *
 * @param {object} block
 */
export function upliftLabel(block) {
  if (block.upliftMode === 'units') return `+${Math.round(block.upliftValue).toLocaleString('en-US')} units`;
  return `+${block.upliftValue}%`;
}

/**
 * True when the block was never saved or differs from its saved copy.
 *
 * @param {object} block
 */
export function hasUnsavedChanges(block) {
  if (!block.saved) return true;
  return SAVED_FIELDS.some((field) => block[field] !== block.saved[field]);
}

/**
 * The block as last saved, or null for a block that was never saved (Discard
 * then removes it).
 *
 * @param {object} block
 */
export function discardBlockChanges(block) {
  if (!block.saved) return null;
  return { ...block, ...block.saved };
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
  const editedSince = SAVED_FIELDS.some((field) => current[field] !== sent[field]);
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
  if (!block.customer) errors.customer = 'Pick a customer.';
  if (!(Number(block.upliftValue) > 0)) {
    errors.upliftValue = block.upliftMode === 'units' ? 'Enter how many units it adds.' : 'Set an uplift above 0%.';
  } else if (block.upliftMode === 'units' && !Number.isInteger(Number(block.upliftValue))) {
    errors.upliftValue = 'Enter a whole number of units.';
  }
  if (!block.startMonth || !block.endMonth) errors.months = 'Pick the months it runs.';
  return errors;
}

/**
 * Request body for saving a block: backend ScenarioBuildingBlockBase
 * (app/schemas/scenario/building_blocks.py). product_name null = all SKUs.
 *
 * @param {object} block
 */
export function buildScenarioBlockPayload(block) {
  return {
    customer_name: block.customer,
    product_name: block.sku || null,
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
    customer: row.customer_name,
    sku: row.product_name ?? '',
    name: row.name,
    explanation: row.explanation ?? '',
    upliftMode: row.uplift_mode,
    upliftValue: Number(row.uplift_value),
    startMonth: row.start_month,
    endMonth: row.end_month,
    isActive: row.is_active,
  };
  return { ...block, saved: savedFieldsOf(block) };
}

/**
 * The blocks that count on the Simulated line and in the pitch summary:
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
      customer: block.customer,
      sku: block.sku,
      explanation: block.explanation,
      startMonth: block.startMonth,
      endMonth: block.endMonth,
    };
  },
};
