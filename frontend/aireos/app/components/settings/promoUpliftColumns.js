import { ACTIONS_COLUMN } from '@/components/ui/TableGrid';
import { PROMO_HINTS } from '@/app/utils/promoUpliftHints';

// The tables on Promotion uplift settings and their History dialogs.
// Fixed widths keep the columns still while the filters change the rows;
// the column without one takes the rest.

export const PROMO_ANCHOR_COLUMNS = [
  { key: 'customer', label: 'Customer', width: '14rem' },
  { key: 'discount', label: 'Ordinary-month discount', width: '12rem' },
  { key: 'source', label: 'Source', width: '11rem' },
  { key: 'suggested', label: 'Suggested from data', hint: PROMO_HINTS.anchorSuggested },
  { key: 'last-changed', label: 'Last changed', width: '14rem' },
  ACTIONS_COLUMN,
];

export const PROMO_UPLIFT_COLUMNS = [
  { key: 'mechanic', label: 'Mechanic', width: '14rem' },
  { key: 'discount', label: 'Discount', width: '7rem', hint: PROMO_HINTS.discountColumn },
  { key: 'uplift', label: 'Uplift', width: '8.5rem', hint: PROMO_HINTS.upliftColumn },
  { key: 'applies-to', label: 'Applies to' },
  { key: 'source', label: 'Source', width: '8.5rem', hint: PROMO_HINTS.sourceColumn },
  { key: 'last-changed', label: 'Last changed', width: '14rem' },
  ACTIONS_COLUMN,
];

export const PROMO_UPLIFT_HISTORY_COLUMNS = [
  { key: 'action', label: 'Action', width: '7rem' },
  { key: 'when', label: 'When', width: '11rem' },
  { key: 'uplift', label: 'Uplift', width: '5.5rem' },
  { key: 'source', label: 'Source', width: '7rem' },
  { key: 'changed-by', label: 'Changed by', width: '8rem' },
  { key: 'note', label: 'Note' },
];

export const PROMO_RULE_HISTORY_COLUMNS = [
  { key: 'action', label: 'Action', width: '7rem' },
  { key: 'when', label: 'When', width: '11rem' },
  { key: 'rate', label: 'Rate (% per point)' },
  { key: 'example', label: '5 points deeper', width: '9rem' },
  { key: 'changed-by', label: 'Changed by', width: '8rem' },
];

export const PROMO_ANCHOR_HISTORY_COLUMNS = [
  { key: 'action', label: 'Action', width: '7rem' },
  { key: 'when', label: 'When', width: '11rem' },
  { key: 'discount', label: 'Discount' },
  { key: 'source', label: 'Source', width: '10rem' },
  { key: 'changed-by', label: 'Changed by', width: '8rem' },
];
