import { ACTIONS_COLUMN, hideClass } from '@/components/ui/TableGrid';

// Catalog values are typed by users and can be any length, so SKU cells wrap
// onto more lines (the row grows) instead of truncating: every value stays
// readable without hovering. break-words splits a single long word that is
// wider than its column.
export const SKU_CELL_CLASS = 'whitespace-normal break-words';

// Fixed widths keep the catalog stable while searching and paging. Product
// and range share the remaining space. The table never scrolls sideways:
// the minor columns drop out one by one as the window narrows (`hideBelow`,
// counted from the viewport, so the open sidebar's 14rem is allowed for), the
// least important first: pack size, UOM, brand, then size. Each width is where
// the table, minus that column, still leaves product and range about 15rem.
// The phone card view shows them all.
export const SKU_COLUMNS = [
  { key: 'sku', label: 'SKU', width: '8rem' },
  { key: 'product', label: 'Product' },
  { key: 'range', label: 'Range' },
  { key: 'size', label: 'Size', width: '7rem', hideBelow: '960px' },
  { key: 'brand', label: 'Brand', width: '8rem', hideBelow: '1024px' },
  { key: 'uom', label: 'UOM', width: '5rem', hideBelow: '1100px' },
  { key: 'pack-size', label: 'Pack size', width: '6rem', align: 'right', hideBelow: '1280px' },
  { key: 'price', label: 'Price', width: '7rem', align: 'right' },
  ACTIONS_COLUMN,
];

// The hide class per SKU_COLUMNS key, for the rows' cells to carry too.
export const SKU_HIDE = Object.fromEntries(SKU_COLUMNS.map((column) => [column.key, hideClass(column)]));

export const SKU_HISTORY_COLUMNS = [
  { key: 'action', label: 'Action', width: '7rem' },
  { key: 'when', label: 'When', width: '11rem' },
  { key: 'product', label: 'Product' },
  { key: 'range', label: 'Range' },
  { key: 'size', label: 'Size', width: '5rem' },
  { key: 'brand', label: 'Brand', width: '6rem' },
  { key: 'uom', label: 'UOM', width: '5rem' },
  { key: 'pack', label: 'Pack', width: '5rem', align: 'right' },
  { key: 'price', label: 'Price', width: '7rem', align: 'right' },
  { key: 'from', label: 'Price from', width: '8rem' },
  { key: 'to', label: 'Price to', width: '8rem' },
];

export const SKU_PRICE_PERIOD_COLUMNS = [
  { key: 'price', label: 'Price', width: '8rem' },
  { key: 'from', label: 'Effective from', width: '15rem' },
  { key: 'to', label: 'Effective to', width: '15rem' },
  { key: 'action', label: 'Action', width: '10rem' },
];

export const SKU_PRICE_CORRECTION_COLUMNS = [
  { key: 'when', label: 'Corrected', width: '11rem' },
  { key: 'old', label: 'Previous price and dates' },
  { key: 'new', label: 'Corrected price and dates' },
  { key: 'by', label: 'By', width: '15rem' },
];
