import { ACTIONS_COLUMN } from '@/components/ui/TableGrid';

// Catalog values are typed by users and can be any length, so SKU cells wrap
// onto more lines (the row grows) instead of truncating: every value stays
// readable without hovering. break-words splits a single long word that is
// wider than its column.
export const SKU_CELL_CLASS = 'whitespace-normal break-words';

// Fixed widths keep the catalog stable while searching and paging. Product
// and range share the remaining space.
export const SKU_COLUMNS = [
  { key: 'sku', label: 'SKU', width: '8rem' },
  { key: 'product', label: 'Product' },
  { key: 'range', label: 'Range' },
  { key: 'size', label: 'Size', width: '7rem' },
  { key: 'brand', label: 'Brand', width: '8rem' },
  { key: 'uom', label: 'UOM', width: '5rem' },
  { key: 'pack-size', label: 'Pack size', width: '6rem', align: 'right' },
  { key: 'price', label: 'Price', width: '7rem', align: 'right' },
  ACTIONS_COLUMN,
];

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
];
