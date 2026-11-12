import { monthNotes, monthlyActuals, previousMadeByMonth } from '@/app/utils/forecastActuals';
import { confidenceBand } from '@/app/utils/forecastLineText';
import { confidenceEntry, pastAccuracy } from '@/app/utils/forecastTiers';
import { splitPromoType } from '@/app/utils/promotionForm';
import { customerLabel } from '@/app/utils/retailerLabel';

export const DEFAULT_PRODUCT_NAME = 'Aire Ultra Tape L';

// Each forecast line is one column of aire_forecasting_output (see backend
// bigquery.FORECAST_OUTPUT_COLUMNS), for the one model (tier) the page shows:
// every line switches together, so a line never mixes models
// (utils/forecastTiers.js picks the rows).
// `archived: true` keeps a line's code and data path intact but hides it from
// the page (chart, toggles, table); no line is archived today.
// `connectNulls: false` leaves a gap where the column is NULL instead of
// bridging it, so a blank month never looks like a forecast.
// The hover text for each line is in utils/forecastLineText.js.
const ALL_FORECAST_SERIES = [
  // Breaks at a month with no actual; ForecastChart joins each gap with a
  // dashed segment (forecastActuals.withActualBridges), so a missing month
  // is never drawn as a point, let alone as 0.
  { key: 'actual', label: 'Actual', color: '#3A4369', dash: undefined, shape: 'circle', connectNulls: false },
  // The year's Jan-Dec plan (aire_forecasting_initial): created from the
  // first September sales, rebuilt as that year's promotions or Oct/Nov
  // sales arrive, locked at 23:59 SGT on 31 December. 2026 was a one-off
  // backfill trained on data up to Dec 2025. A SKU with no initial row
  // (e.g. Ultra Tape in 2026) simply draws no line.
  { key: 'initial', label: 'Initial Yearly Forecast', color: '#E8922A', dash: '2 4', shape: 'square' },
  // The forecast made before each SKU's latest month of sales
  // (forecast_previous, chosen per SKU and tier). A model with none for the
  // SKUs in scope greys its pill out instead of drawing it.
  // Thinner and dashed, so Current reads as the line to plan on. Kept at full
  // opacity: faded, it vanished into the lavender promo bands behind it.
  {
    key: 'previous',
    label: 'Previous',
    color: '#7C3AED',
    dash: '8 3',
    shape: 'triangle',
    connectNulls: false,
    strokeWidth: 1.8,
  },
  // The latest run, 12 months after the newest sales month. Bold and solid.
  { key: 'current', label: 'Current', color: '#0D9488', dash: undefined, shape: 'diamond', strokeWidth: 3 },
];

export const FORECAST_SERIES = ALL_FORECAST_SERIES.filter((series) => !series.archived);

export const ALL_SERIES_VISIBLE = Object.fromEntries(
  FORECAST_SERIES.map((series) => [series.key, true])
);

// promo_mix values from fc_future_input. no_promos also means "nothing
// entered yet" for future months.
export const PROMO_MIX_LABELS = {
  both_promos: 'Monthly + weekly offer',
  monthly_only: 'Monthly promo',
  weekly_only: 'Weekly offer only',
  no_promos: 'None entered',
};

// Carton column on an output row per series. The Forecast page is volume
// only (backend forecast_service.get_forecast_view prices nothing).
const SERIES_COLUMNS = {
  initial: 'forecast_initial',
  previous: 'forecast_previous',
  current: 'forecast_current',
};

const DEFAULT_PROMO_BADGE_CLASS = 'border-lavander bg-cream text-deep-violet-blue/70';

// Base types only. Pack vs carton is a second filter; stored values are
// `monthly` or `carton_monthly` (see splitPromoType in promotionForm.js).
export const PROMO_OVERLAY_TYPES = [
  {
    value: 'monthly',
    label: 'Monthly',
    // Deeper than brand lavender (#DFE4F7), which is all but the chart's own
    // background colour, so a lavender band could not be seen.
    color: '#B9C1E6',
    swatch: '#3A4369',
    selectedBg: '#3A4369',
    selectedFg: '#FFFFFF',
    strokeColor: '#3A4369',
    fillOpacity: 0.45,
    strokeOpacity: 0.16,
    badgeClass: 'border-deep-violet-blue/20 bg-lavander text-deep-violet-blue',
  },
  {
    value: 'side_offer',
    label: 'Side offer',
    color: '#A7D2F2',
    swatch: '#A7D2F2',
    selectedBg: '#2E7BA6',
    selectedFg: '#FFFFFF',
    fillOpacity: 0.28,
    strokeOpacity: 0.24,
    badgeClass: 'border-celest/50 bg-celest/20 text-deep-violet-blue',
  },
  {
    value: 'bundle',
    label: 'Bundle',
    color: '#A29BCC',
    swatch: '#A29BCC',
    selectedBg: '#5C5299',
    selectedFg: '#FFFFFF',
    fillOpacity: 0.22,
    strokeOpacity: 0.22,
    badgeClass: 'border-violet/40 bg-violet/15 text-deep-violet-blue',
  },
  {
    value: 'others',
    label: 'Others',
    color: '#EAE4DE',
    swatch: '#C4B6A6',
    selectedBg: '#8A7460',
    selectedFg: '#FFFFFF',
    strokeColor: '#C4B6A6',
    fillOpacity: 0.4,
    strokeOpacity: 0.28,
    badgeClass: 'border-violet/30 bg-cream text-deep-violet-blue',
  },
];

// Unused by line series or overlay pills: burnt orange + olive.
export const PACK_OVERLAY_TYPES = [
  {
    value: 'pack',
    label: 'Pack',
    swatch: '#C45C26',
    selectedBg: '#C45C26',
    selectedFg: '#FFFFFF',
  },
  {
    value: 'carton',
    label: 'Carton',
    swatch: '#4F7A3A',
    selectedBg: '#4F7A3A',
    selectedFg: '#FFFFFF',
  },
];

export const ALL_PROMO_TYPE_VALUES = PROMO_OVERLAY_TYPES.map((item) => item.value);
export const ALL_PACK_TYPE_VALUES = PACK_OVERLAY_TYPES.map((item) => item.value);

export function promoOverlayStyle(promoType) {
  const promo = PROMO_OVERLAY_TYPES.find((item) => item.value === promoType);
  if (!promo) return null;
  return {
    fill: promo.color,
    fillOpacity: promo.fillOpacity,
    stroke: promo.strokeColor ?? promo.color,
    strokeOpacity: promo.strokeOpacity,
  };
}

export function promoBadgeClass(promoType) {
  return (
    PROMO_OVERLAY_TYPES.find((item) => item.value === promoType)?.badgeClass ??
    DEFAULT_PROMO_BADGE_CLASS
  );
}

// The axis and tooltip formatters below keep their revenue branch for the
// assistant's charts (AssistantMessage); the Forecast page passes 'units'.
export function formatAxisValue(value, metric) {
  if (typeof value !== 'number') return value;
  if (metric === 'revenue') {
    if (Math.abs(value) >= 1000) {
      return `$${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
    }
    return `$${value}`;
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  }
  return `${value}`;
}

export function niceYDomain(values) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = dataMax - dataMin;
  const padding = span * 0.1 || Math.abs(dataMax) * 0.1 || 1;
  let low = dataMin - padding;
  let high = dataMax + padding;
  if (low < 0 && dataMin >= 0) low = 0;
  const rawStep = (high - low) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep || 1));
  const residual = rawStep / magnitude;
  const step = residual >= 5 ? 10 * magnitude : residual >= 2 ? 5 * magnitude : 2 * magnitude;
  return [Math.floor(low / step) * step, Math.ceil(high / step) * step];
}

export function formatTooltipValue(value, metric) {
  if (typeof value !== 'number') return value;
  if (metric === 'revenue') {
    return `$${value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return Math.round(value).toLocaleString('en-US');
}

export function formatMonthLabel(monthYear) {
  if (!monthYear) return '';
  return new Date(`${monthYear}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
  });
}

export function formatGeneratedAt(isoDate) {
  if (!isoDate) return '—';
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatTimestamp(value) {
  if (!value) return '—';
  const hasTime = /T\d{2}:\d{2}/.test(value);
  if (!hasTime) {
    return formatGeneratedAt(String(value).slice(0, 10));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    timeZone: 'Asia/Singapore',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * One chart/table point per month: Actual plus the three forecast lines,
 * summed across the SKUs in scope. `rows` must be one model's rows
 * (utils/forecastTiers.js), never several tiers'.
 *
 * The Actual comes from forecastActuals.monthlyActuals: a missing month
 * (actual_status 'missing_file') stays null, never 0, and `actualKind` /
 * `actualCoverage` say whether a month is missing or only partly reported.
 * Actuals and forecasts are separate series and never added together.
 * `previousMade` lists when each SKU's Previous was made.
 *
 * The promo situation and Current dot band belong to one series, so they
 * are only filled when `singleSeries` is true (one customer + one SKU).
 * `confidence` holds one entry per SKU with a Current or Previous forecast
 * that month, each with its own 80% range (forecastTiers.confidenceEntry);
 * per-SKU bounds are never added into a range for a total.
 *
 * Cartons only: GET /api/forecast carries no revenue. `metric` stays in the
 * signature for its callers and is always 'units'.
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 * @param {object[]} actuals monthly actuals from GET /api/forecast
 * @param {'units'} _metric
 * @param {{ singleSeries?: boolean }} options
 */
export function buildMonthlyPoints(rows, actuals = [], _metric = 'units', { singleSeries = false } = {}) {
  const byMonth = new Map();

  function pointFor(monthYear) {
    if (!byMonth.has(monthYear)) {
      byMonth.set(monthYear, emptyMonthlyPoint(monthYear));
    }
    return byMonth.get(monthYear);
  }

  for (const [monthYear, actual] of monthlyActuals(rows, actuals)) {
    if (actual.value == null && !actual.kind) continue;
    const point = pointFor(monthYear);
    point.actual = actual.value;
    point.actualKind = actual.kind;
    point.actualCoverage = actual.coverage;
  }

  for (const [monthYear, made] of previousMadeByMonth(rows)) {
    pointFor(monthYear).previousMade = made;
  }

  // Past accuracy per customer x SKU, for months that only have a Previous
  // (the view leaves current_confidence_band blank there).
  const rowsBySeries = new Map();
  for (const row of rows) {
    const key = `${row.customer_id}|${row.sku}`;
    if (!rowsBySeries.has(key)) rowsBySeries.set(key, []);
    rowsBySeries.get(key).push(row);
  }
  const pastBySeries = new Map(
    [...rowsBySeries].map(([key, seriesRows]) => [key, pastAccuracy(seriesRows)])
  );

  for (const row of rows) {
    if (!row.month_year) continue;
    const point = pointFor(row.month_year);

    for (const [seriesKey, column] of Object.entries(SERIES_COLUMNS)) {
      const value = row[column] ?? null;
      if (value != null) point[seriesKey] = (point[seriesKey] ?? 0) + value;
    }

    const confidence = row.tier
      ? confidenceEntry(row, {
          low: row.current_low_80 ?? null,
          high: row.current_high_80 ?? null,
          previousLow: row.previous_low_80 ?? null,
          previousHigh: row.previous_high_80 ?? null,
          past: pastBySeries.get(`${row.customer_id}|${row.sku}`),
        })
      : null;
    if (confidence) point.confidence.push(confidence);

    if (singleSeries) {
      point.promoMix = row.promo_mix;
      point.currentBand = row.forecast_current != null ? confidenceBand(row.month_confidence_band) : null;
    }
  }

  return [...byMonth.values()].sort((a, b) => a.month_year.localeCompare(b.month_year));
}

/**
 * The rest of a month for the tooltip and promo panel: a missing or partial
 * Actual, what the Current value assumed about promotions, and when the
 * Previous values were made (with `showPrevious`, the Previous line being
 * on). The model is the whole line's (the Model dropdown), and the 80%
 * range sits in the CONFIDENCE section (ForecastConfidenceDetails).
 */
export function forecastPointDetails(point, { showPrevious = false } = {}) {
  if (!point) return [];
  const notes = monthNotes(point, {
    formatCustomer: customerLabel,
    formatStamp: formatSgtTimestamp,
    showPrevious,
  });
  const actualNotes = notes.filter((note) => note.label === 'Actual');
  const previousNotes = notes.filter((note) => note.label === 'Previous');
  const details = [...actualNotes];
  if (point.promoMix) {
    details.push({ label: 'Promo', value: PROMO_MIX_LABELS[point.promoMix] ?? point.promoMix });
  }
  return [...details, ...previousNotes];
}

export function emptyMonthlyPoint(monthYear) {
  return {
    month_year: monthYear,
    label: formatMonthLabel(monthYear),
    actual: null,
    actualKind: null,
    actualCoverage: null,
    initial: null,
    previous: null,
    previousMade: [],
    current: null,
    currentBand: null,
    confidence: [],
    promoMix: null,
  };
}

export function monthsInRange(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const months = [];
  let year = Number(startDate.slice(0, 4));
  let month = Number(startDate.slice(5, 7));
  const endYear = Number(endDate.slice(0, 4));
  const endMonth = Number(endDate.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}-01`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export function nextMonthYear(monthYear) {
  if (!monthYear) return '';
  const year = Number(monthYear.slice(0, 4));
  const month = Number(monthYear.slice(5, 7));
  if (month === 12) return `${year + 1}-01-01`;
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

export function padMonthlyPoints(points, startDate, endDate) {
  const months = monthsInRange(startDate, endDate);
  if (!months.length) return points;
  const byMonth = new Map(points.map((point) => [point.month_year, point]));
  return months.map((monthYear) => byMonth.get(monthYear) ?? emptyMonthlyPoint(monthYear));
}

export function toggleSelectedValue(selected, value) {
  if (selected.includes(value)) {
    return selected.filter((item) => item !== value);
  }
  return [...selected, value];
}

export function promoMatchesOverlay(promo, selectedTypes, selectedPacks) {
  const { promoType, packType } = splitPromoType(promo?.promo_type);
  return Boolean(selectedTypes?.includes(promoType) && selectedPacks?.includes(packType));
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function lastDayOfMonth(monthYear) {
  const year = Number(monthYear.slice(0, 4));
  const month = Number(monthYear.slice(5, 7));
  const day = daysInMonth(year, month);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function bandColors(group) {
  return [
    ...new Set(
      group
        .map((promo) => promoOverlayStyle(splitPromoType(promo.promo_type).promoType)?.fill)
        .filter(Boolean)
    ),
  ];
}

function dateToAxisX(isoDate, months, edge) {
  if (!isoDate || !months.length) return 0;
  if (isoDate < months[0]) return 0;
  const lastMonth = months.at(-1);
  if (isoDate > lastDayOfMonth(lastMonth)) return months.length;

  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const monthKey = `${year}-${String(month).padStart(2, '0')}-01`;
  const index = months.indexOf(monthKey);
  if (index < 0) return edge === 'end' ? months.length : 0;
  const dim = daysInMonth(year, month);
  return edge === 'end' ? index + day / dim : index + (day - 1) / dim;
}

export function buildPromoOverlayBands(promotions, selectedTypes, selectedPacks, months) {
  if (!months.length) return [];
  const visible = (promotions || []).filter((promo) =>
    promoMatchesOverlay(promo, selectedTypes, selectedPacks)
  );
  const groups = new Map();
  for (const promo of visible) {
    const key = `${promo.period_start}|${promo.period_end}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(promo);
  }

  const chartStart = months[0];
  const chartEnd = lastDayOfMonth(months.at(-1));
  return [...groups.entries()].flatMap(([key, group], index) => {
    const start = group[0].period_start;
    const end = group[0].period_end;
    if (!start || !end || end < chartStart || start > chartEnd) return [];
    const x1 = dateToAxisX(start, months, 'start');
    const x2 = dateToAxisX(end, months, 'end');
    if (!(x2 > x1)) return [];
    const colors = bandColors(group);
    return [
      {
        key: `promo-${start}-${end}-${index}`.replace(/[^a-zA-Z0-9-]/g, '-'),
        x1,
        x2,
        colors,
        fillOpacity: colors.length > 1 ? 0.5 : promoOverlayStyle(splitPromoType(group[0].promo_type).promoType)?.fillOpacity ?? 0.28,
        promos: group,
      },
    ];
  });
}

export function promosOverlappingMonth(promotions, monthYear, selectedTypes, selectedPacks) {
  if (!monthYear) return [];
  const monthStart = monthYear;
  const monthEnd = lastDayOfMonth(monthYear);
  return (promotions || []).filter((promo) => {
    if (!promo.period_start || !promo.period_end) return false;
    if (!promoMatchesOverlay(promo, selectedTypes, selectedPacks)) return false;
    return promo.period_start <= monthEnd && promo.period_end >= monthStart;
  });
}

export function promoIdentity(promo) {
  return promo.promotion_id ?? `${promo.promo_type}|${promo.period_start}|${promo.period_end}|${promo.promotion_mechanic}`;
}

function promoIdSet(promotions, monthYear, selectedTypes, selectedPacks) {
  return new Set(
    promosOverlappingMonth(promotions, monthYear, selectedTypes, selectedPacks).map(promoIdentity)
  );
}

function promoSetsDiffer(previous, next) {
  if (previous.size !== next.size) return true;
  for (const id of previous) {
    if (!next.has(id)) return true;
  }
  return false;
}

// Vertical hairline at the month tick where the selected overlay set changes
// (e.g. Jan–Feb promo then Feb–Mar promo → line at February).
export function promoPeriodDividerXs(promotions, selectedTypes, selectedPacks, months) {
  const xs = [];
  let previous = new Set();
  months.forEach((monthYear, index) => {
    const next = promoIdSet(promotions, monthYear, selectedTypes, selectedPacks);
    if (index > 0 && (previous.size || next.size) && promoSetsDiffer(previous, next)) {
      xs.push(index);
    }
    previous = next;
  });
  return xs;
}

// The Current line summed over the points given. Only a 12-month total when
// the points hold the whole line: the Forecast page reads its "Next 12
// months" from the backend instead (forecast_service.current_horizon_totals),
// since its date filter can cut the line short. (A partly loaded month can
// have both an actual and a forecast; the forecast still counts.)
export function sumHorizonForecast(points) {
  return points.reduce((total, point) => {
    if (point.current == null) return total;
    return total + point.current;
  }, 0);
}

// ============================================================
// YEARLY TOTALS
// ============================================================

/**
 * The Jan-Dec span of every calendar year the date filter touches, clamped
 * to the months that exist.
 *
 * The year cards always read as whole years, so a filter of Jun 2025 - Mar
 * 2026 still needs Jan 2025 - Dec 2026 of data. Returns the same range it
 * was given when that already covers the full years, which is the default
 * current-year view -- the caller uses that to skip a second fetch.
 */
export function fullYearWindow(startDate, endDate, bounds = {}) {
  if (!startDate || !endDate) return null;
  let start = `${startDate.slice(0, 4)}-01-01`;
  // 1 Dec, the same end as the page's default range (dateRange.currentYearDateRange):
  // monthly rows are keyed by the first of the month, so it still takes in
  // December, and the default view needs no wider fetch.
  let end = `${endDate.slice(0, 4)}-12-01`;
  if (bounds.start && bounds.start > start) start = bounds.start;
  if (bounds.end && bounds.end < end) end = bounds.end;
  return { start, end };
}

// The year cards' totals are in forecastYearTotals.buildYearlyTotals.

export function pickDefaultProduct(products) {
  if (!products.length) return '';
  if (products.includes(DEFAULT_PRODUCT_NAME)) return DEFAULT_PRODUCT_NAME;
  return products[0];
}

export function toggleSeriesVisibility(visible, key) {
  return { ...visible, [key]: !visible[key] };
}

export function uniqueMonthOptions(points) {
  const seen = new Set();
  return points.flatMap((point) => {
    // A missing month is still a row: the table says "Missing" there.
    const hasData =
      point.actual != null ||
      point.actualKind === 'missing' ||
      point.initial != null ||
      point.previous != null ||
      point.current != null;
    if (!hasData || !point.month_year || seen.has(point.month_year)) return [];
    seen.add(point.month_year);
    return [{ value: point.month_year, label: point.label }];
  });
}

// ============================================================
// LAST UPDATED
// ============================================================

const SGT_FORMAT = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** A pipeline TIMESTAMP (UTC ISO) shown in Singapore time, or '—'. */
export function formatSgtTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return SGT_FORMAT.format(date);
}
