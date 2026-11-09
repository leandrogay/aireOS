// Which months the dashboard's Period and Compare to pickers may offer: only
// those inside the loaded data of the ticked customers (backend
// get_default_date_range: earliest_start .. end, across every ticked
// customer). Pure and import-free, so `npm test` can run it
// (tests/dataBounds.test.mjs). Dates are ISO YYYY-MM-DD strings; months are
// compared as their 'YYYY-MM' prefix, so a range is "inside" when its first
// and last months are.

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
 * Hover text for an option that reaches outside the data, e.g.
 * "Only Mar 2026 – Oct 2026 has data for the selected customers".
 *
 * @param {string} earliestDataStart
 * @param {string} latestDataEnd
 * @returns {string}
 */
export function outsideDataNote(earliestDataStart, latestDataEnd) {
  const label = (iso) =>
    new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  if (!earliestDataStart || !latestDataEnd) return 'Outside the loaded data';
  return `Only ${label(earliestDataStart)} – ${label(latestDataEnd)} has data for the selected customers`;
}
