// Which months the dashboard's Period and Compare to pickers may offer: only
// those inside the loaded data of the ticked customers (backend
// get_default_date_range: earliest_start .. end, across every ticked
// customer). Pure; its one import is relative and import-free itself, so
// `npm test` can run it (tests/dataBounds.test.mjs). Dates are ISO
// YYYY-MM-DD strings; months are compared as their 'YYYY-MM' prefix, so a
// range is "inside" when its first and last months are.

import { DEFAULT_COMPARE, comparisonSetup, formatPeriodName, periodBounds } from './periodComparison.js';

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

/**
 * The Period the dashboard uses: the picked one while it is inside the
 * ticked customers' data, else the default (Latest month). Switching from
 * Prime (data to Oct) to FairPrice (to Aug) would otherwise leave the page on
 * an empty October the picker no longer offers; the pick itself is kept by
 * the caller, so ticking Prime again brings it back. While the bounds are
 * `updating` they are the previous selection's, so the pick stands.
 *
 * @param {{ start: string, end: string }} picked '' while nothing is picked
 * @param {{ start: string, end: string }} defaultRange
 * @param {{ earliestDataStart: string, latestDataEnd: string, updating?: boolean }} bounds
 * @returns {{ start: string, end: string, picked: boolean }} `picked`: the pick applies
 */
export function periodInUse(picked, defaultRange, { earliestDataStart, latestDataEnd, updating = false }) {
  const applies =
    Boolean(picked.start && picked.end) && (updating || isWithinData(picked, earliestDataStart, latestDataEnd));
  return applies ? { ...picked, picked: true } : { ...defaultRange, picked: false };
}

/**
 * comparisonSetup for the Compare to the dashboard uses: the chosen one, or
 * none when its period is outside the data (Same period last year after
 * switching to a customer whose data starts this year), rather than
 * comparing against nothing. Not while the bounds are `updating`.
 *
 * @param {string} compareTo the chosen option's value
 * @param {object} rangeInputs as comparisonSetup takes them
 * @param {{ earliestDataStart: string, latestDataEnd: string, updating?: boolean }} bounds
 * @returns {{ compareTo: string, options: Array<object>, baseline: { start: string, end: string } | null, periodNames: object }}
 */
export function comparisonInUse(compareTo, rangeInputs, { earliestDataStart, latestDataEnd, updating = false }) {
  const chosen = comparisonSetup(compareTo, rangeInputs);
  const fits = !chosen.baseline || updating || isWithinData(chosen.baseline, earliestDataStart, latestDataEnd);
  if (fits) return { compareTo, ...chosen };
  return { compareTo: DEFAULT_COMPARE, ...comparisonSetup(DEFAULT_COMPARE, rangeInputs) };
}
