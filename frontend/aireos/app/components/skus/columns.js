import { ACTIONS_COLUMN } from '@/components/ui/TableGrid';

// Fixed widths keep the catalog stable while searching and paging. Product
// and range share the remaining space and truncate with their full value in
// the cell title.
export const SKU_COLUMNS = [
  { key: 'sku', label: 'SKU', width: '8rem' },
  { key: 'product', label: 'Product' },
  { key: 'range', label: 'Range' },
  { key: 'size', label: 'Size', width: '5rem' },
  { key: 'brand', label: 'Brand', width: '6rem' },
  { key: 'uom', label: 'UOM', width: '5rem' },
  { key: 'pack-size', label: 'Pack size', width: '6rem' },
  { key: 'price', label: 'Price', width: '7rem' },
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
  { key: 'pack', label: 'Pack', width: '5rem' },
  { key: 'price', label: 'Price', width: '7rem' },
];
