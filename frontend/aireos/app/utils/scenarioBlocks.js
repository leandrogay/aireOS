// ============================================================
// SCENARIO SOURCE: BUILDING BLOCKS -- pure, no React
// ============================================================
//
// User-entered uplifts (a fair booth, new outlets, a trade push) in the
// Scenario builder. Not the same thing as the forecast pipeline's
// "Building Blocks" (pl_forecast.py) or inventory's sell_out_building_blocks;
// in code these are always "scenario blocks" (blueprint open question 8).
//
// A block:
//   {
//     id, customer, sku,            // sku '' = all SKUs
//     name, explanation,            // free text; explanation is optional
//     upliftPct,                    // e.g. 18 for +18%
//     startMonth, endMonth,         // 'YYYY-MM-01', forecast months only
//   }

import { upliftDeltaCells } from '@/app/utils/scenarioEngine';

// Suggested as the user types a block name (blueprint Part 1.2).
export const BLOCK_NAME_SUGGESTIONS = [
  'Eldercare Fair Booth GWP',
  'New Outlet Opening',
  'Trade Marketing Push',
  'Online Marketing',
  'Bundle Offer',
];

export const UPLIFT_PRESETS = [5, 10, 18, 25];
export const MAX_UPLIFT_PCT = 50;

export const NEW_BLOCK_NAME = 'New building block';

/**
 * A new block for the given customer/SKU, covering the first forecast month.
 *
 * @param {{ customer: string, sku: string, months: string[] }} defaults
 */
export function newScenarioBlock({ customer = '', sku = '', months = [] }) {
  return {
    id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    customer,
    sku,
    name: NEW_BLOCK_NAME,
    explanation: '',
    upliftPct: 10,
    startMonth: months[0] ?? '',
    endMonth: months[0] ?? '',
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

export const scenarioBlocksSource = {
  key: 'blocks',
  itemsKey: 'blocks',
  label: 'Building block',
  deltas(blocks, rows) {
    return blocks.flatMap((block) => upliftDeltaCells(rows, block, block.upliftPct, 'blocks'));
  },
  describe(block) {
    return {
      title: block.name || NEW_BLOCK_NAME,
      upliftLabel: `+${block.upliftPct}%`,
      customer: block.customer,
      sku: block.sku,
      explanation: block.explanation,
      startMonth: block.startMonth,
      endMonth: block.endMonth,
    };
  },
};
