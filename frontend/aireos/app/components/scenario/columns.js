import { ACTIONS_COLUMN } from '@/components/ui/TableGrid';

// The saved building blocks table's columns. Every column but Explanation
// has a fixed width for its longest usual value, and together they stay
// well under the page's 72rem (max-w-6xl), so Explanation always keeps room
// of its own and the Actions menu never slides off the right edge.
// Explanation truncates (full text in the expanded row). Customer and SKU share a column; the customer
// part only shows when the page's Customer filter is "All customers" --
// otherwise every row would repeat it. `sortField`s are the fields
// sortBlocks() in BlockTable accepts.
const NAME = { key: 'name', label: 'Building block', width: '13rem', sortField: 'name' };
const REST = [
  { key: 'months', label: 'Months', width: '8rem', sortField: 'startMonth' },
  { key: 'uplift', label: 'Uplift', width: '6.5rem' },
  { key: 'gain', label: 'Gain', width: '8.5rem' },
  { key: 'explanation', label: 'Explanation' },
  { key: 'active', label: 'Active', width: '5.5rem' },
  ACTIONS_COLUMN,
];

export function blockColumns(showCustomer) {
  const appliesTo = { key: 'appliesTo', label: showCustomer ? 'Customer · SKU' : 'SKU', width: '11rem' };
  return [NAME, appliesTo, ...REST];
}
