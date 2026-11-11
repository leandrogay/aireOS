import { ACTIONS_COLUMN } from '@/components/ui/TableGrid';

// Fixed widths for everything but the customer name, so the numbers never
// shift as the list refreshes; the name takes the rest.
const DOH_WIDTH = '7rem';

export const DOH_COLUMNS = [
  { key: 'customer', label: 'Customer' },
  { key: 'min', label: 'Min DOH', width: DOH_WIDTH, align: 'right' },
  { key: 'target', label: 'Target DOH', width: DOH_WIDTH, align: 'right' },
  { key: 'max', label: 'Max DOH', width: DOH_WIDTH, align: 'right' },
  { key: 'updated', label: 'Last updated', width: '11rem' },
  { key: 'alerts', label: 'Alerts', width: '6rem' },
  ACTIONS_COLUMN,
];
