import { ACTIONS_COLUMN } from '@/components/ui/TableGrid';

// One column grid for every table on the Customers page, so the customer
// table and each retailer table under it line up regardless of their data:
// name | detail (takes the rest) | status | actions. Only the labels differ.
const NAME_WIDTH = '18rem';
const STATUS_WIDTH = '9rem';

export const CUSTOMER_COLUMNS = [
  { key: 'name', label: 'Customer', width: NAME_WIDTH },
  { key: 'retailers', label: 'Retailers' },
  { key: 'status', label: 'Status', width: STATUS_WIDTH },
  ACTIONS_COLUMN,
];

export const RETAILER_COLUMNS = [
  { key: 'name', label: 'Retailer', width: NAME_WIDTH },
  { key: 'stores', label: 'Stores' },
  { key: 'status', label: 'Status', width: STATUS_WIDTH },
  ACTIONS_COLUMN,
];
