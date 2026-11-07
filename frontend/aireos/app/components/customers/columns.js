import { ACTIONS_COLUMN } from '@/components/ui/TableGrid';

// Retailers are shown in the expanded table, rather than abbreviated in the
// customer row ("Fairprice Offline +1" hid which other retailer was linked).
const NAME_WIDTH = '13rem';
const STATUS_WIDTH = '7rem';

export const CUSTOMER_COLUMNS = [
  { key: 'name', label: 'Customer', width: NAME_WIDTH },
  { key: 'status', label: 'Status', width: STATUS_WIDTH },
  ACTIONS_COLUMN,
];

export const RETAILER_COLUMNS = [
  { key: 'name', label: 'Retailer', width: NAME_WIDTH },
  { key: 'stores', label: 'Stores' },
  { key: 'status', label: 'Status', width: STATUS_WIDTH },
  ACTIONS_COLUMN,
];
