import { ACTIONS_COLUMN } from '@/components/ui/TableGrid';

// The promotion overview's columns. Retailer, dates, period, type and status
// get fixed widths that fit their longest value (retailer: chevron plus
// "Fairprice Offline +1" on one line; a longer name wraps rather than being
// cut off, see PromotionRow). Stores and mechanic share the rest and truncate
// (full text in the cell's title). `sortField`s are the fields
// sortPromotions() in app/utils/promotionOverview.js accepts.
export const PROMOTION_COLUMNS = [
  { key: 'retailer', label: 'Retailer', width: '13rem' },
  { key: 'stores', label: 'Stores' },
  { key: 'start', label: 'Start date', width: '8rem', sortField: 'period_start' },
  { key: 'end', label: 'End date', width: '8rem', sortField: 'period_end' },
  { key: 'period', label: 'Period', width: '9rem' },
  { key: 'type', label: 'Promo type', width: '8rem' },
  { key: 'mechanic', label: 'Mechanic' },
  { key: 'status', label: 'Status', width: '8.5rem' },
  ACTIONS_COLUMN,
];
