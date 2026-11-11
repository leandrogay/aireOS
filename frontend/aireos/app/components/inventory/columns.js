import { ACTIONS_COLUMN } from '@/components/ui/TableGrid';

// The Inventory tabs' table columns (ui/TableGrid), declared once per table.
// Fixed widths keep the columns still between pages; Product has none, so it
// takes what's left of the table's min-width and truncates (full name in the
// cell's title). The `month` column is where InventoryTableFrame puts its
// Month filter. Labels with a hyphen go through headingLabel so a wrapped
// heading never breaks at it ("Forecast / sell-out", not "Forecast sell- / out").

/**
 * A column heading whose hyphens never break: plain hyphens become
 * non-breaking ones (U+2011), which look the same.
 *
 * @param {string} label
 * @returns {string}
 */
export function headingLabel(label) {
  return label.replaceAll('-', '‑');
}

const MONTH_COLUMN = { key: 'month', label: 'Month', width: '7rem' };

/**
 * InventorySkuTable's columns: Customer only when `showCustomer`, the DOH
 * columns only when `showDoh`, the "..." menu only when `editable`.
 *
 * @param {{ showCustomer: boolean, showDoh: boolean, editable: boolean }} options
 * @returns {object[]}
 */
export function inventorySkuColumns({ showCustomer, showDoh, editable }) {
  return [
    showCustomer && { key: 'customer', label: 'Customer', width: '8rem' },
    MONTH_COLUMN,
    { key: 'sku', label: 'SKU', width: '6.5rem' },
    { key: 'product', label: 'Product' },
    { key: 'opening', label: 'Opening', width: '5.5rem', align: 'right' },
    { key: 'sellIn', label: headingLabel('Sell-in'), width: '5.5rem', align: 'right' },
    { key: 'sellOut', label: headingLabel('Sell-out'), width: '5.5rem', align: 'right' },
    { key: 'blocks', label: 'Building blocks', width: '6.5rem', align: 'right' },
    { key: 'ending', label: 'Ending stock', width: '6rem', align: 'right' },
    ...(showDoh
      ? [
        { key: 'doh', label: 'DOH', width: '4.5rem', align: 'right' },
        { key: 'target', label: 'Target', width: '5rem', align: 'right' },
        { key: 'gap', label: 'vs target', width: '6rem', align: 'right' },
        // Fits "Within range" on one line.
        { key: 'status', label: 'Status', width: '8rem' },
      ]
      : []),
    editable && ACTIONS_COLUMN,
  ].filter(Boolean);
}

// The sell-in plan, in the order it is worked out (SellInPlanTable).
export const SELL_IN_PLAN_COLUMNS = [
  MONTH_COLUMN,
  { key: 'product', label: 'Product' },
  { key: 'opening', label: 'Opening inventory', width: '7rem', align: 'right' },
  // Room for the Initial tag.
  { key: 'forecast', label: headingLabel('Forecast sell-out'), width: '8rem', align: 'right' },
  { key: 'shipped', label: headingLabel('Temporary sell-in'), width: '7rem', align: 'right' },
  { key: 'needed', label: 'Stock needed', width: '6.5rem', align: 'right' },
  { key: 'recommended', label: headingLabel('Recommended sell-in'), width: '7.5rem', align: 'right' },
  { key: 'dohAfter', label: headingLabel('DOH after sell-in'), width: '6.5rem', align: 'right' },
  { key: 'projected', label: 'Projected ending', width: '7rem', align: 'right' },
];

// Every at-risk SKU across customers (AtRiskView).
export const AT_RISK_COLUMNS = [
  { key: 'customer', label: 'Customer', width: '8rem' },
  MONTH_COLUMN,
  { key: 'sku', label: 'SKU', width: '6.5rem' },
  { key: 'product', label: 'Product' },
  { key: 'ending', label: 'Ending stock', width: '6rem', align: 'right' },
  { key: 'doh', label: 'DOH', width: '4.5rem', align: 'right' },
  { key: 'min', label: 'Min', width: '4.5rem', align: 'right' },
  { key: 'max', label: 'Max', width: '4.5rem', align: 'right' },
  { key: 'outside', label: 'Days outside band', width: '6.5rem', align: 'right' },
  { key: 'risk', label: 'Risk', width: '6.5rem' },
];

// The sell-in tracker's values before they are saved (SellInUploadForm).
export const SELL_IN_PREVIEW_COLUMNS = [
  { key: 'customer', label: 'Customer', width: '8rem' },
  MONTH_COLUMN,
  { key: 'product', label: 'Product' },
  { key: 'qty', label: 'Qty in packs', width: '7rem', align: 'right' },
  { key: 'current', label: 'Current', width: '6rem', align: 'right' },
  { key: 'status', label: 'Status', width: '7rem' },
];
