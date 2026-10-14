// One column grid for every table on the Customers page, so the customer
// table and each retailer table under it line up regardless of their data:
// name | detail (takes the rest) | status | actions. Each table uses
// `table-fixed`, so these widths are kept instead of growing with content.
const NAME_WIDTH = '18rem';
const STATUS_WIDTH = '9rem';
const ACTIONS_WIDTH = '4.5rem';

// How far a nested table's edges sit inside the customer table's edges:
// the expanded row's px-4 plus the nested table's 1px border.
export const EXPANDED_ROW_INSET = '1rem + 1px';
// The "without a customer" card: its p-3 plus the table's 1px border.
export const CARD_INSET = '0.75rem + 1px';

/**
 * `<colgroup>` for the shared grid. A table inset from the customer table's
 * edges by `inset` (a CSS length sum) takes that off its first and last
 * columns, so its column boundaries land exactly on the customer table's.
 *
 * @param {{ inset?: string }} props
 */
export default function ColumnGrid({ inset }) {
  const narrowed = (width) => (inset ? `calc(${width} - (${inset}))` : width);

  return (
    <colgroup>
      <col style={{ width: narrowed(NAME_WIDTH) }} />
      <col />
      <col style={{ width: STATUS_WIDTH }} />
      <col style={{ width: narrowed(ACTIONS_WIDTH) }} />
    </colgroup>
  );
}
