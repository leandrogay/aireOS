import {
  RECURRENCE_OPTIONS,
  formatPromoDate,
  formatYmd,
  promoTypeLabel,
} from '@/app/utils/promotionForm';

const RECURRENCE_STORAGE_KEY = 'aireos.promotionRecurrence';

export const PROMOTION_STATUSES = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'active', label: 'Active' },
  { value: 'past', label: 'Past' },
];

/**
 * Compare period_start / period_end to today.
 *
 * Upcoming: today is before start. Active: today is in range.
 * Past: today is after end. Dates from GET /api/promotions.
 *
 * @param {object} promotion
 * @param {Date} [today]
 * @returns {'upcoming' | 'active' | 'past'}
 */
export function promotionStatus(promotion, today = new Date()) {
  const todayYmd = formatYmd(today);
  const start = formatPromoDate(promotion.period_start);
  const end = formatPromoDate(promotion.period_end);

  if (start && start !== '—' && todayYmd < start) return 'upcoming';
  if (end && end !== '—' && todayYmd > end) return 'past';
  return 'active';
}

/**
 * Label for a status badge.
 *
 * @param {string} status
 * @returns {string}
 */
export function promotionStatusLabel(status) {
  const match = PROMOTION_STATUSES.find((item) => item.value === status);
  return match ? match.label : status;
}

/**
 * Event name for the overview. The API has no event_name column, so this
 * is built from period_label + promo type (and mechanic when present).
 *
 * @param {object} promotion
 * @returns {string}
 */
export function promotionEventName(promotion) {
  const tag = promotion.period_label || 'Promotion';
  const type = promoTypeLabel(promotion.promo_type);
  const mechanic = String(promotion.promotion_mechanic || '').trim();
  return mechanic ? `${tag} · ${type} · ${mechanic}` : `${tag} · ${type}`;
}

/**
 * Recurrence map kept in localStorage until the backend has a column.
 *
 * @returns {Record<string, string>}
 */
export function readStoredRecurrenceMap() {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(RECURRENCE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Remember the form recurrence for newly created promotion ids.
 *
 * @param {Array<number | string>} promotionIds
 * @param {string} recurrence
 */
export function rememberPromotionRecurrence(promotionIds, recurrence) {
  if (typeof window === 'undefined' || !recurrence || recurrence === 'none') {
    return;
  }

  const current = readStoredRecurrenceMap();
  for (const id of promotionIds || []) {
    if (id != null) current[String(id)] = recurrence;
  }
  window.localStorage.setItem(RECURRENCE_STORAGE_KEY, JSON.stringify(current));
}

/**
 * Recurrence value for one GET row (frontend overlay).
 *
 * @param {object} promotion
 * @param {Record<string, string>} [storedMap]
 * @returns {string}
 */
export function recurrenceForPromotion(promotion, storedMap = readStoredRecurrenceMap()) {
  return storedMap[String(promotion?.promotion_id)] || 'none';
}

/**
 * Recurrence label for the overview column.
 *
 * @param {string} [recurrence]
 * @returns {string}
 */
export function promotionRecurrenceLabel(recurrence = 'none') {
  const match = RECURRENCE_OPTIONS.find((item) => item.value === recurrence);
  return match ? match.label : 'Does not repeat';
}

/**
 * Parse YYYY-MM-DD without UTC shift.
 *
 * @param {string | Date | null | undefined} value
 * @returns {Date | null}
 */
function parseLocalYmd(value) {
  const ymd = formatPromoDate(value);
  if (!ymd || ymd === '—') return null;
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/**
 * Frontend-only occurrence list for a recurring promotion.
 *
 * Weekly / monthly / yearly dates are generated from the stored
 * period so staff can preview instances. Only the first occurrence
 * exists in Cloud SQL.
 *
 * @param {object} promotion
 * @param {string} recurrence
 * @returns {Array<{ index: number, start: string, end: string }>}
 */
export function promotionOccurrences(promotion, recurrence = 'none') {
  const start = parseLocalYmd(promotion.period_start);
  const end = parseLocalYmd(promotion.period_end);
  if (!start || !end) return [];

  const spanDays = Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)),
  );
  const count =
    recurrence === 'weekly' ? 6 : recurrence === 'monthly' ? 6 : recurrence === 'yearly' ? 3 : 1;

  const items = [];
  for (let index = 0; index < count; index += 1) {
    const occStart = new Date(start);
    if (recurrence === 'weekly') occStart.setDate(start.getDate() + index * 7);
    if (recurrence === 'monthly') occStart.setMonth(start.getMonth() + index);
    if (recurrence === 'yearly') occStart.setFullYear(start.getFullYear() + index);

    const occEnd = new Date(occStart);
    occEnd.setDate(occStart.getDate() + spanDays);
    items.push({
      index: index + 1,
      start: formatYmd(occStart),
      end: formatYmd(occEnd),
    });
  }
  return items;
}

/**
 * Unique retailer names from the loaded promotion rows.
 *
 * @param {object[]} promotions
 * @returns {string[]}
 */
export function uniquePromotionRetailers(promotions) {
  return [...new Set((promotions || []).map((item) => item.retailer).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

/**
 * Unique period_label values for the time-period filter.
 *
 * @param {object[]} promotions
 * @returns {string[]}
 */
export function uniquePromotionPeriods(promotions) {
  return [...new Set((promotions || []).map((item) => item.period_label).filter(Boolean))].sort();
}

/**
 * Unique stores from loaded promotion rows. Optionally limited to one retailer.
 *
 * @param {object[]} promotions
 * @param {string} [retailer]
 * @returns {Array<{ store_code: string, store_name: string }>}
 */
export function uniquePromotionStores(promotions, retailer = '') {
  const seen = new Map();

  for (const item of promotions || []) {
    if (retailer && item.retailer !== retailer) continue;
    const code = item.store_code == null ? '' : String(item.store_code);
    const name = String(item.store_name || '').trim();
    const key = code || name;
    if (!key || seen.has(key)) continue;
    seen.set(key, { store_code: code, store_name: name || code });
  }

  return [...seen.values()].sort((left, right) =>
    left.store_name.localeCompare(right.store_name),
  );
}

/**
 * Apply retailer, store, status, and period filters. Overlapping rows are kept.
 *
 * @param {object[]} promotions
 * @param {{ retailer: string, store: string, status: string, period: string }} filters
 * @returns {object[]}
 */
export function filterPromotions(promotions, filters) {
  const retailer = filters.retailer || '';
  const store = filters.store || '';
  const status = filters.status || '';
  const period = filters.period || '';

  return (promotions || []).filter((promotion) => {
    if (retailer && promotion.retailer !== retailer) return false;
    if (store && String(promotion.store_code ?? '') !== store) return false;
    if (status && promotionStatus(promotion) !== status) return false;
    if (period && promotion.period_label !== period) return false;
    return true;
  });
}

/**
 * Sort by period_start or period_end.
 *
 * @param {object[]} promotions
 * @param {'period_start' | 'period_end'} field
 * @param {'asc' | 'desc'} direction
 * @returns {object[]}
 */
export function sortPromotions(promotions, field, direction) {
  const factor = direction === 'desc' ? -1 : 1;
  return [...(promotions || [])].sort((left, right) => {
    const leftValue = formatPromoDate(left[field]);
    const rightValue = formatPromoDate(right[field]);
    if (leftValue === rightValue) {
      return Number(right.promotion_id || 0) - Number(left.promotion_id || 0);
    }
    return leftValue < rightValue ? -1 * factor : 1 * factor;
  });
}
