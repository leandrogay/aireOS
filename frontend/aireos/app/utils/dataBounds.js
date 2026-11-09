// Which months the dashboard's Period and Compare to pickers may offer: only
// those inside the loaded data of the ticked customers (backend
// get_default_date_range: earliest_start .. end, across every ticked
// customer). Pure; its one import is relative and import-free itself, so
// `npm test` can run it (tests/dataBounds.test.mjs). Dates are ISO
// YYYY-MM-DD strings; months are compared as their 'YYYY-MM' prefix, so a
// range is "inside" when its first and last months are.

import { formatPeriodName, periodBounds } from './periodComparison.js';

function monthOf(iso) {
  return iso ? iso.slice(0, 7) : '';
}

/**
 * Whether a range's months all have loaded data. With no bounds known yet
 * (still loading) everything counts as inside, so nothing is disabled early.
 *
 * @param {{ start: string, end: string } | null | undefined} range
 * @param {string} earliestDataStart first loaded day
 * @param {string} latestDataEnd last loaded day
 * @returns {boolean}
 */
export function isWithinData(range, earliestDataStart, latestDataEnd) {
  if (!range?.start || !range?.end) return true;
  if (earliestDataStart && monthOf(range.start) < monthOf(earliestDataStart)) return false;
  if (latestDataEnd && monthOf(range.end) > monthOf(latestDataEnd)) return false;
  return true;
}

/**
 * Hover text for an option that reaches outside the data, e.g. "Outside
 * Mar – Oct 2026, the months with data for at least one selected customer".
 * "At least one": a month inside may still have data for only one of them.
 *
 * @param {string} earliestDataStart
 * @param {string} latestDataEnd
 * @returns {string}
 */
export function outsideDataNote(earliestDataStart, latestDataEnd) {
  if (!earliestDataStart || !latestDataEnd) return 'Outside the loaded data';
  const months = formatPeriodName(periodBounds('month', earliestDataStart).start, periodBounds('month', latestDataEnd).end);
  return `Outside ${months}, the months with data for at least one selected customer`;
}
