import {
  formatPromoDate,
  formatYmd,
  promoTypeLabel,
} from '@/app/utils/promotionForm';
import { singaporeToday } from '@/lib/singaporeTime';

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const RECURRENCE_STORAGE_KEY = 'aireos.promotionRecurrence';

export const PROMOTION_STATUSES = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'active', label: 'Active' },
  { value: 'past', label: 'Past' },
];

/**
 * Compare period_start / period_end to today (the Singapore calendar day).
 *
 * Upcoming: today is before start. Active: today is in range.
 * Past: today is after end. Dates from GET /api/promotions. The backend's
 * status filter and search use the same rule (promotion_service _STATUS_SQL).
 *
 * @param {object} promotion
 * @param {Date} [now]
 * @returns {'upcoming' | 'active' | 'past'}
 */
export function promotionStatus(promotion, now = new Date()) {
  const todayYmd = formatYmd(singaporeToday(now));
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
 * Linked stores of one GET /api/promotions row (promotion_stores).
 *
 * @param {object} promotion
 * @returns {Array<{ store_id?: number, store_name?: string, store_code?: string, store_format?: string | null, retailer_id?: number, retailer?: string }>}
 */
export function promotionStores(promotion) {
  return Array.isArray(promotion?.stores) ? promotion.stores : [];
}

/**
 * Unique retailer names linked to one promotion.
 *
 * @param {object} promotion
 * @returns {string[]}
 */
export function promotionRetailerNames(promotion) {
  return [
    ...new Set(promotionStores(promotion).map((store) => store.retailer).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

/**
 * Unique store names linked to one promotion.
 *
 * @param {object} promotion
 * @returns {string[]}
 */
export function promotionStoreNames(promotion) {
  return [
    ...new Set(promotionStores(promotion).map((store) => store.store_name).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
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
