// Wording for the Forecast page's line pills and "last updated" stamp
// (forecast-frontend-update-handover F2-F6). Pure and import-free so
// `npm test` (node --test) can check it without the Next.js aliases.
//
// The wording follows how the BigQuery forecast works now: it retrains on its
// own a few minutes after an app save (backend forecast_refresh_worker), the
// Initial Yearly Forecast is made from 1 September with the Tier 0 model only
// and locked at the end of 31 October, and each customer's actuals stop at
// that customer's latest file. The page's ⓘ text is in forecastHelpText.js.

export const FORECAST_LAST_UPDATED_LABEL = 'Forecast last updated';

// The yearly plan's rule (the pipeline locks it at the end of this day). A
// rule, not data: each year's real lock time comes from
// GET /api/forecast/initial-status.
export const INITIAL_BUILD_DAY = '1 Sep';
export const INITIAL_LOCK_DAY = '31 Oct';

export const ACTUAL_HINT =
  "Actual: reported sell-out from the customer's sales files, in cartons. A month with no sales for a product " +
  "counts as 0. A month the customer hasn't sent is shown as Missing, never 0.";

// Budgeting (Scenario builder, Budget planning mode): Aire builds a budget on
// top of next year's plan (building blocks and promotions) and locks it with
// "Lock budget"; locking again saves a new version, the newest shown. A locked
// budget replaces the Initial line on the Forecast and Inventory charts.
export const INITIAL_BUDGET_NOTE =
  'Once Aire locks a budget in the Scenario builder (this plan plus the building blocks and promotions added on ' +
  'top of it), this line shows that budget instead in the months it covers, here and on the Inventory page, ' +
  'while Show locked yearly budget is on (it is on by default; turn it off to see the plan). Locking again saves a new ' +
  'version, and the newest one is shown.';

// The backend gives every model Tier 0's Initial (bigquery.with_tier0_initial).
export const INITIAL_HINT =
  'Initial Yearly Forecast: the plan for the year, made with the Tier 0 model whichever model is selected. ' +
  `Next year's plan is made from ${INITIAL_BUILD_DAY}, using the sales available then (usually up to July or ` +
  "August). It's updated whenever new sales (up to September) or promotion changes come in, then locked at the " +
  `end of ${INITIAL_LOCK_DAY}, so the whole year is measured against one fixed plan. October sales and later ` +
  'never change it. ' +
  INITIAL_BUDGET_NOTE;

function joinYears(years) {
  const list = [...new Set(years ?? [])].sort((a, b) => a - b);
  if (list.length <= 1) return { text: String(list[0] ?? ''), plural: false };
  return { text: `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`, plural: true };
}

/**
 * Why no Initial is drawn for the SKUs in scope. Not an error. The plan is
 * Tier 0's on every model and Tier 0 covers every SKU, so the only reason is
 * a SKU that launched after that year's plan was made.
 *
 * @param {{ years: number[], skuCount?: number }} options years in the date range
 */
export function initialMissingHint({ years, skuCount = 1 }) {
  const { text, plural } = joinYears(years);
  const subject = skuCount > 1 ? 'these SKUs' : 'this SKU';
  const plan = text ? `the ${text} ${plural ? 'plans were' : 'plan was'} made` : 'the yearly plan was made';
  return `No Initial yearly forecast: ${subject} launched after ${plan}.`;
}

/**
 * "Initial yearly forecast: shown for 3 of 5 selected SKUs." when only some
 * customer x SKUs in scope have the line on the selected model, so its sum is
 * never a silent partial. '' when all or none have it (none greys the pill).
 *
 * @param {string} lineLabel
 * @param {{ withLine: number, total: number }} coverage forecastActuals.lineCoverage
 */
export function lineCoverageNote(lineLabel, { withLine, total }) {
  if (!total || withLine === 0 || withLine === total) return '';
  return `${lineLabel}: shown for ${withLine} of ${total} selected SKUs.`;
}

// Previous is the same model retrained on one month less sales
// (previous_data_month, normally current_data_month - 1), rebuilt on every
// retrain. `months` is dataMonthsText's "Sep 2026"; '' leaves the month out.
export function previousHint(months = '') {
  const data = months ? ` (made with sales up to ${months})` : '';
  return (
    `Previous forecast: the same model's forecast with one month less sales data${data}. Compare it with ` +
    "the Current forecast to see what the newest month changed. It's rebuilt at every update, so it always means \"one month " +
    'less data", whatever order files were uploaded in.'
  );
}

export const PREVIOUS_HINT = previousHint();

// The selected model has no Previous for any SKU in scope (per SKU and tier:
// forecast_previous on that tier's rows). A SKU's first month of sales has
// nothing to leave out, so Previous needs a second one.
export const PREVIOUS_MISSING_HINT =
  'No Previous forecast for this model yet — it appears once this product has two months of sales (or once it has ' +
  'enough history for this model).';

/** The Current pill's hover; `months` (current_data_month) as previousHint. */
export function currentHint(months = '') {
  const data = months ? `, made with sales up to ${months}` : ', made on the newest month of sales';
  return `Current forecast: the latest forecast${data}. Shows the 12 months after that.`;
}

export const CURRENT_HINT = currentHint();

/**
 * Hover text for each line pill, by series key. `initialMissing` is the
 * reason the Initial pill is greyed out (initialMissingHint), '' when it
 * isn't; `previousMissing` greys out Previous. `currentMonths` /
 * `previousMonths` are dataMonthsText for the lines in scope ('' leaves the
 * month out, as on the Scenario builder).
 *
 * @param {{ initialMissing?: string, previousMissing?: boolean, currentMonths?: string, previousMonths?: string }} options
 */
export function forecastLineHints({
  initialMissing = '',
  previousMissing = false,
  currentMonths = '',
  previousMonths = '',
} = {}) {
  return {
    actual: ACTUAL_HINT,
    initial: initialMissing || INITIAL_HINT,
    previous: previousMissing ? PREVIOUS_MISSING_HINT : previousHint(previousMonths),
    current: currentHint(currentMonths),
  };
}

// ============================================================
// MISSING AND PARTIAL ACTUALS (actual_status)
// ============================================================

// Hover-card labels for what each line was made with (forecastActuals.monthNotes).
export const PREVIOUS_DETAIL_LABEL = 'Previous forecast';
export const CURRENT_DETAIL_LABEL = 'Current forecast';

// Values beside an "Actual" label in the tooltip (forecastActuals.monthNotes).
export const ACTUAL_MISSING_TEXT = 'missing (no sales file for this month)';

/** "partial — missing for Nhg (no sales file)"; customers already formatted. */
export function actualPartialMissingText(customers) {
  return `partial — missing for ${customers.join(', ')} (no sales file)`;
}

/** "Actuals for 3 of 5 SKUs; 2 still forecast for Aug" */
export function actualsStillForecastText({ reported, waiting, month }) {
  const total = reported + waiting;
  return `Actuals for ${reported} of ${total} SKUs; ${waiting} still forecast for ${month}`;
}

// The table never shows a missing month as "—" or 0.
export const TABLE_MISSING_LABEL = 'Missing';
export const TABLE_MISSING_HINT = 'No sales file for this month.';
export const TABLE_PARTIAL_LABEL = 'partial';
export const TABLE_PARTIAL_HINT =
  "Partial: at least one selected customer hasn't sent this month's file, so this total is missing their sales " +
  "(they're not counted as 0).";

// ============================================================
// WHAT EACH LINE WAS MADE WITH (current_data_month / previous_data_month)
// ============================================================

// Past this many customers, the hover card's rows collapse to "+N more";
// past this many odd SKUs in one customer, so do they.
const DATA_MONTH_ROW_LIMIT = 6;
const DATA_MONTH_SKU_LIMIT = 3;

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "Sep 2026" for a YYYY-MM-DD month; '' for none. A calendar month, never shifted. */
export function dataMonthLabel(month) {
  if (!month) return '';
  return MONTH_YEAR.format(new Date(`${String(month).slice(0, 10)}T00:00:00Z`));
}

// One group per customer: the month most of its SKUs share (the later one
// on a tie) and the SKUs on another month. The data month is per SKU, so a
// SKU missing from the customer's latest file can be a month behind.
function dataMonthGroups(entries) {
  const byCustomer = new Map();
  for (const entry of entries ?? []) {
    if (!entry?.month) continue;
    const name = entry.customerName ?? '';
    if (!byCustomer.has(name)) byCustomer.set(name, []);
    byCustomer.get(name).push(entry);
  }
  return [...byCustomer]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([customerName, list]) => {
      const counts = new Map();
      for (const entry of list) counts.set(entry.month, (counts.get(entry.month) ?? 0) + 1);
      const [month] = [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
      const odd = list.filter((entry) => entry.month !== month);
      return { customerName, month, odd };
    });
}

function groupMonthText(group) {
  const label = dataMonthLabel(group.month);
  if (!group.odd.length) return label;
  const shown = group.odd
    .slice(0, DATA_MONTH_SKU_LIMIT)
    .map((entry) => `${entry.productName}: ${dataMonthLabel(entry.month)}`);
  const more = group.odd.length - shown.length;
  return `${label} (${[...shown, ...(more > 0 ? [`+${more} more`] : [])].join(', ')})`;
}

// One month for everything in scope: no per-customer detail needed.
function singleMonth(groups) {
  const months = new Set(groups.map((group) => group.month));
  return months.size === 1 && groups.every((group) => !group.odd.length) ? groups[0].month : null;
}

/**
 * The month(s) a line was made with, for its pill: "Sep 2026" when every
 * customer x SKU in scope shares it, else "FairPrice: Sep 2026 · NHG: Aug 2026"
 * (a customer's odd SKUs in brackets). '' with no months.
 *
 * @param {{ customerName: string, productName: string, month: string }[]} entries forecastActuals.dataMonthEntries
 * @param {(name: string) => string} [formatCustomer] customerLabel
 */
export function dataMonthsText(entries, formatCustomer = (name) => name) {
  const groups = dataMonthGroups(entries);
  if (!groups.length) return '';
  const month = singleMonth(groups);
  if (month) return dataMonthLabel(month);
  if (groups.length === 1) return groupMonthText(groups[0]);
  return groups.map((group) => `${formatCustomer(group.customerName)}: ${groupMonthText(group)}`).join(' · ');
}

/**
 * The hover card's rows for one month of a line: "Made with sales up to
 * Sep 2026", or one row per customer ("FairPrice: sales up to Sep 2026")
 * when their months differ, past DATA_MONTH_ROW_LIMIT "+N more".
 *
 * @param {{ customerName: string, productName: string, month: string }[]} entries
 * @param {(name: string) => string} [formatCustomer]
 */
export function dataMonthLines(entries, formatCustomer = (name) => name) {
  const groups = dataMonthGroups(entries);
  if (!groups.length) return [];
  const month = singleMonth(groups);
  if (month) return [`Made with sales up to ${dataMonthLabel(month)}`];
  if (groups.length === 1) return [`Made with sales up to ${groupMonthText(groups[0])}`];
  const lines = groups.map(
    (group) => `${formatCustomer(group.customerName)}: sales up to ${groupMonthText(group)}`
  );
  const shown = lines.slice(0, DATA_MONTH_ROW_LIMIT);
  const more = lines.length - shown.length;
  return more > 0 ? [...shown, `+${more} more`] : shown;
}

// ============================================================
// INITIAL VS ACTUAL
// ============================================================

// Tooltip label for how far the Initial Yearly Forecast was from the Actual
// (short: the details column is narrow; the value names the Actual).
export const INITIAL_VS_ACTUAL_LABEL = 'Initial';

/**
 * "8% over actual (197 cartons)", "5% under actual (120 cartons)", or
 * "matched actual" from forecastActuals.initialVsActual. The % is of the
 * Actual; with an Actual of 0 only the cartons are shown.
 */
export function initialVsActualText({ diff, pct }) {
  const cartons = Math.round(Math.abs(diff));
  if (cartons === 0) return 'matched actual';
  const direction = diff > 0 ? 'over' : 'under';
  const amount = `${cartons.toLocaleString('en-US')} cartons`;
  if (pct == null) return `${amount} ${direction} actual`;
  return `${Math.round(Math.abs(pct))}% ${direction} actual (${amount})`;
}

// ============================================================
// MODEL (TIER) PICKER
// ============================================================

// One model at a time, never a recommended or mixed one: the client builds
// their own plan on the model they choose. Values and order match the view's
// tier / tier_order (backend bigquery.FORECAST_TIERS).
export const TIER0_HINT =
  'A simple, transparent baseline: half of the same month last year plus half of the average of the last 3 months ' +
  "with sales. Where there's no same month last year, it's the 3-month average alone, so the line is flat. No " +
  'promotion effect. Available for every SKU, including new ones.';

export const TIER1_BASIC_HINT =
  "A statistical time-series model (Google BigQuery ARIMA_PLUS) that learns each product's trend and seasonal " +
  'pattern from its sales history. Needs at least 12 months of sales.';

export const TIER1_ADVANCED_HINT =
  'The same model plus the promotion calendar (ARIMA_PLUS_XREG), so planned promotions move the forecast. Needs at ' +
  'least 12 months of sales, and a promotion in the next 12 months of a type this product has run at least 3 times before.';

export const FORECAST_TIER_OPTIONS = [
  { value: 'tier0', label: 'Tier 0 · Baseline', description: TIER0_HINT },
  { value: 'tier1_basic', label: 'Tier 1 · Basic (ARIMA_PLUS)', description: TIER1_BASIC_HINT },
  { value: 'tier1_advanced', label: 'Tier 1 · Advanced (ARIMA_PLUS_XREG)', description: TIER1_ADVANCED_HINT },
];

// Why a model is greyed out, per unavailable_reason from
// aire_forecasting_output. `monthsOfHistory` (the row's months_of_history)
// fills in not_enough_history when one product is in scope.
export const UNAVAILABLE_REASON_TEXT = {
  not_enough_history: ({ monthsOfHistory }) =>
    monthsOfHistory == null
      ? "Needs 12 months of sales. Months with no sales file don't count."
      : `Needs 12 months of sales; this product has ${monthsOfHistory}. Months with no sales file don't count.`,
  no_familiar_promotions: () =>
    'No promotion planned in the next 12 months that this product has run at least 3 times before, so promotions ' +
    "can't add anything over Tier 1 Basic yet.",
  incomplete_forecast: () => "This model didn't produce a full 12 months for this product in the latest update.",
  not_backtested: () =>
    "This model hasn't been accuracy-tested on this product yet (it needs enough past months to test on).",
  no_forecast: () => 'No forecast from this model for this product yet.',
};

const UNAVAILABLE_FALLBACK = 'Not available for this SKU';

export function unavailableReasonText(reason, { monthsOfHistory = null } = {}) {
  const text = UNAVAILABLE_REASON_TEXT[reason];
  return text ? text({ monthsOfHistory }) : UNAVAILABLE_FALLBACK;
}

/**
 * Why a model can't be picked for the SKUs in scope. One SKU: its reason
 * (with its months of sales when that is the reason). Several: how many
 * can't use it, plus the reason when they all share one.
 *
 * @param {{ reasons: (string | null)[], total: number, monthsOfHistory?: number | null }} options one reason per SKU that can't use it
 */
export function tierUnavailableText({ reasons, total, monthsOfHistory = null }) {
  if (!reasons.length) return '';
  if (total <= 1) return unavailableReasonText(reasons[0], { monthsOfHistory });
  const shared = new Set(reasons).size === 1 ? ` · ${unavailableReasonText(reasons[0])}` : '';
  return `Not available for ${reasons.length} of ${total} selected SKUs${shared}`;
}

export const NO_DATA_FOR_TIER = 'No forecast from this model matches these filters.';

// ============================================================
// CONFIDENCE (tooltip + past-accuracy badge)
// ============================================================

export const CONFIDENCE_BAND_LABELS = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
};

/** A band from the view as a CONFIDENCE_BAND_LABELS key ('unknown' for NULL or anything else). */
export function confidenceBand(band) {
  return band in CONFIDENCE_BAND_LABELS ? band : 'unknown';
}

export const CONFIDENCE_INFO =
  "This month = how wide the model's 80% range is for this month (the Current forecast, Previous forecast and Initial each have their own). " +
  "Past accuracy = the model's average error (sMAPE) when tested on recent months we hid from it; " +
  'one score for both lines, since the same model made them.';

// Band cut-offs, both "<= 20 high, <= 50 medium, else low": month_range_pct
// for This month, current_backtest_smape for Past accuracy.
// Behind the CONFIDENCE info icon, so the hover card itself stays short.
export const INITIAL_CONFIDENCE_INFO =
  `Initial's range comes with the yearly plan, so it is fixed once the plan locks at the end of ${INITIAL_LOCK_DAY}. ` +
  'It is wider for later months of the year, because they were further ahead when the plan was made.';

export const CONFIDENCE_BANDS_INFO =
  'This month: High within ±20%, Medium within ±50%, Low wider. ' +
  'Past accuracy: High at sMAPE 20% or less, Medium up to 50%, Low above.';

export const THIS_MONTH_LABEL = 'This month';
export const PAST_ACCURACY_LABEL = 'Past accuracy';

/** "±30%", or '' when the view has no range for the month. */
export function rangePctText(pct) {
  return pct == null ? '' : `±${Math.round(pct)}%`;
}

/** "sMAPE 12%", or "not tested yet" with no backtest. */
export function smapeText(smape) {
  return smape == null ? 'not tested yet' : `sMAPE ${Math.round(smape)}%`;
}

/**
 * The lower bound of an 80% range as shown: never below 0 (an ARIMA range
 * can dip below 0 for a small SKU, but sales can't). Null stays null.
 */
export function shownRangeLow(low) {
  return low == null ? null : Math.max(0, low);
}

/** "8 in 10 chance it lands between 700 and 1,300" from already-formatted bounds; '' without both. */
export function rangeChanceText(low, high) {
  if (!low || !high) return '';
  return `8 in 10 chance it lands between ${low} and ${high}`;
}

// The Current and Previous lines' dots show that month's confidence by fill
// (one SKU and customer only), never by colour alone; the hover card repeats
// the same symbol beside its words, so the chart needs no separate key.
export const CONFIDENCE_DOT_FILL ={ high: 'filled', medium: 'half', low: 'hollow', unknown: 'small' };

/** "Low confidence" for a month_confidence_band (unknown for NULL). */
export function confidenceWords(band) {
  return `${CONFIDENCE_BAND_LABELS[confidenceBand(band)]} confidence`;
}

export const TYPICAL_PROMO_NOTE = "Promotion not familiar — model used this SKU's usual promotion.";

/** The SKU-level badge under the legend, e.g. "Past accuracy: High · sMAPE 12%". */
export function pastAccuracyBadgeLabel({ band, smape }) {
  return `${PAST_ACCURACY_LABEL}: ${CONFIDENCE_BAND_LABELS[confidenceBand(band)]} · ${smapeText(smape)}`;
}

export const PAST_ACCURACY_BADGE_HINT =
  "How far off this model was, on average, when we tested it on recent months it wasn't allowed to see (sMAPE: " +
  'average % error, treating over- and under-forecasts alike). High under 20%, Medium 20–50%, Low over 50%. ' +
  "Tier 1 is tested 4 times (pretending it's 3, 4, 5 and 6 months ago, forecasting 3 months each time); Tier 0 " +
  "once (3 months ago), so the two scores aren't exactly like-for-like.";

// ============================================================
// INITIAL YEARLY FORECAST STATUS (F7)
// ============================================================

const SGT_DAY = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** A UTC ISO stamp as its Singapore calendar day, e.g. "31 Oct 2026"; '' when missing. */
export function sgtDay(stamp) {
  if (!stamp) return '';
  const date = new Date(stamp);
  return Number.isNaN(date.getTime()) ? '' : SGT_DAY.format(date);
}

// Plans locked on a day other than the rule's, and why. 2027 was still open
// when the 31 Oct rule started (12 Nov 2026), so it was locked straight away.
// A fixed fact about that one plan, shown only when 2027 is in view.
export const EARLY_LOCK_NOTES = {
  2027:
    'The yearly plan now locks on 31 Oct. 2027 was still open when this rule started on 12 Nov 2026, so it ' +
    'was locked straight away, with the sales and promotions it had that day.',
};

/**
 * One note per year in the selected range, from that year's row in
 * aire_forecasting_initial_meta (GET /api/forecast/initial-status):
 *   - open (not `locked`): "Updating until <lock day>. The <year> plan still
 *     takes in new sales and promotion changes. After <lock day> it's fixed."
 *   - locked: "Fixed plan. The <year> plan was locked on <lock day>, using
 *     sales up to <data_cutoff month>. It won't change."
 *   - no row yet for next year, 1 Jan - 31 Aug: "The <year> plan is made
 *     from 1 Sep <this year>. Until then only this year's plan is shown."
 * Lock days come from each row's lock_at (Singapore day), never typed in. A
 * year with no row otherwise (the 2026 backfill) gets no note. A plan in
 * EARLY_LOCK_NOTES adds that line after its own.
 *
 * @param {{
 *   rangeYears: number[],
 *   meta: { forecast_year: number, lock_at: string | null, data_cutoff?: string | null, locked: boolean }[],
 *   today: Date,
 * }} options today is Singapore's (lib/singaporeTime.singaporeToday)
 * @returns {string[]}
 */
export function initialStatusNotes({ rangeYears, meta, today }) {
  const metaByYear = new Map((meta ?? []).map((row) => [row.forecast_year, row]));
  const thisYear = today.getFullYear();
  // Next year's plan can't exist before 1 Sep (month index 8).
  const beforeBuild = today.getMonth() < 8;
  return [...new Set(rangeYears ?? [])]
    .sort((a, b) => a - b)
    .flatMap((year) => {
      const row = metaByYear.get(year);
      if (!row) {
        if (year === thisYear + 1 && beforeBuild) {
          return [`The ${year} plan is made from ${INITIAL_BUILD_DAY} ${thisYear}. Until then only this year's plan is shown.`];
        }
        return [];
      }
      const lockDay = sgtDay(row.lock_at);
      let note;
      if (row.locked) {
        const locked = lockDay ? ` was locked on ${lockDay}` : ' is locked';
        const data = row.data_cutoff ? `, using sales up to ${dataMonthLabel(row.data_cutoff)}` : '';
        note = `Fixed plan. The ${year} plan${locked}${data}. It won't change.`;
      } else {
        const until = lockDay || INITIAL_LOCK_DAY;
        note = `Updating until ${until}. The ${year} plan still takes in new sales and promotion changes. After ${until} it's fixed.`;
      }
      return EARLY_LOCK_NOTES[year] ? [note, EARLY_LOCK_NOTES[year]] : [note];
    });
}

/** Every calendar year from startDate to endDate ('YYYY-MM-DD'), inclusive. */
export function yearsInRange(startDate, endDate) {
  const start = Number(String(startDate ?? '').slice(0, 4));
  const end = Number(String(endDate ?? '').slice(0, 4));
  if (!start || !end || end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

// ============================================================
// "FORECAST UPDATING…" BADGE (F8)
// ============================================================

export const FORECAST_UPDATING_LABEL = 'Forecast updating…';

export const FORECAST_UPDATING_HINT =
  'A change was just saved and the forecast is being recalculated (about 10–15 minutes). The bell tells you when ' +
  "it's done; the page shows the new numbers after that.";

// A refresh that retrains nothing writes no notification, so while the badge
// shows the page re-checks on this timer until the status clears.
export const REFRESH_STATUS_RECHECK_MS = 60_000;

// The same retrain also rebuilds an open Initial Yearly Forecast (from its
// September build until it locks at the end of October), so while one is open
// the badge names the Initial line too -- as well as, not instead of, the forecast.
export const INITIAL_UPDATING_LABEL = 'Forecast updating… (incl. Initial)';

export const INITIAL_UPDATING_HINT =
  'A change was just saved and the forecast, including the Initial Yearly Forecast (open until it locks at the ' +
  `end of ${INITIAL_LOCK_DAY}), is being recalculated (about 10–15 minutes). The bell tells you when it's done; ` +
  'the page shows the new numbers after that.';

/**
 * The badge for a refresh-status response, or null when nothing is updating.
 * `initialMeta` (GET /api/forecast/initial-status years) decides the wording:
 * any year not yet locked means this refresh also moves the Initial line.
 *
 * @param {{ updating?: boolean } | null | undefined} status
 * @param {{ locked: boolean }[]} [initialMeta]
 */
export function forecastUpdatingBadge(status, initialMeta = []) {
  if (!status?.updating) return null;
  const initialOpen = (initialMeta ?? []).some((row) => !row.locked);
  return initialOpen
    ? { label: INITIAL_UPDATING_LABEL, hint: INITIAL_UPDATING_HINT }
    : { label: FORECAST_UPDATING_LABEL, hint: FORECAST_UPDATING_HINT };
}

/** Milliseconds until the next status check: only while updating, else null (stop). */
export function nextStatusCheckDelay(status) {
  return status?.updating ? REFRESH_STATUS_RECHECK_MS : null;
}
