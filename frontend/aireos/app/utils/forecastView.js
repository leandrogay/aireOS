import { splitPromoType } from '@/app/utils/promotionForm';

export const DEFAULT_PRODUCT_NAME = 'Aire Ultra Tape L';

// Each forecast line is one column of aire_forecasting_output (see backend
// bigquery.FORECAST_OUTPUT_COLUMNS); the BigQuery pipeline picks the best
// model per month, so the page only sums and draws them.
export const FORECAST_SERIES = [
  { key: 'actual', label: 'Actual', color: '#3A4369', dash: undefined, shape: 'circle' },
  // Frozen Jan-Dec best line, snapshotted each December for the next year
  // (aire_forecasting_initial); the first one is for 2027.
  { key: 'initial', label: 'Initial Yearly Forecast', color: '#E8922A', dash: '2 4', shape: 'square' },
  // The run before the latest; blank for a month that just entered the window.
  { key: 'previous', label: 'Previous', color: '#7C3AED', dash: '8 3', shape: 'triangle' },
  // The latest run, 12 months after the newest sales month.
  { key: 'current', label: 'Current', color: '#0D9488', dash: '3 3', shape: 'diamond' },
];

export const ALL_SERIES_VISIBLE = Object.fromEntries(
  FORECAST_SERIES.map((series) => [series.key, true])
);

// source_model values written by run_monthly_forecast_pipeline /
// run_tier0_legacy in BigQuery. Keep in sync with those procedures. Both
// ARIMA models (with and without promo input) show as one Tier 1 label;
// which of the two won a month isn't a distinction the page needs.
export const SOURCE_MODEL_LABELS = {
  tier1_arima: 'Tier 1 advanced',
  tier1_arimax: 'Tier 1 advanced',
  tier0_legacy: 'Tier 0 baseline',
};

// promo_mix values from fc_future_input. no_promos also means "nothing
// entered yet" for future months.
export const PROMO_MIX_LABELS = {
  both_promos: 'Monthly + weekly offer',
  monthly_only: 'Monthly promo',
  weekly_only: 'Weekly offer only',
  no_promos: 'None entered',
};

export function sourceModelLabel(model) {
  if (!model) return '';
  return SOURCE_MODEL_LABELS[model] ?? model;
}

// Carton column on an output row per series, and the revenue column the
// backend priced it into (forecast_service.add_forecast_revenue).
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
    color: '#DFE4F7',
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

function actualValue(row, metric) {
  if (metric === 'revenue') {
    return row.revenue == null ? null : row.revenue;
  }
  return row.quantity_cartons == null ? null : row.quantity_cartons;
}

function columnValue(row, column, metric) {
  const key = metric === 'revenue' ? `${column}_revenue` : column;
  return row[key] ?? null;
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
 * summed across the SKUs in scope.
 *
 * The 80% range, confidence and promo situation belong to one series, so
 * they are only filled when `singleSeries` is true (one customer + one SKU).
 * Adding per-SKU bounds does not give an 80% range for the total.
 *
 * @param {object[]} rows forecast rows from GET /api/forecast
 * @param {object[]} actuals monthly actuals from GET /api/forecast
 * @param {'units'|'revenue'} metric
 * @param {{ singleSeries?: boolean }} options
 */
export function buildMonthlyPoints(rows, actuals = [], metric = 'units', { singleSeries = false } = {}) {
  const byMonth = new Map();

  function pointFor(monthYear) {
    if (!byMonth.has(monthYear)) {
      byMonth.set(monthYear, emptyMonthlyPoint(monthYear));
    }
    return byMonth.get(monthYear);
  }

  for (const row of actuals) {
    if (!row.month_year) continue;
    const value = actualValue(row, metric);
    if (value == null) continue;
    const point = pointFor(row.month_year);
    point.actual = (point.actual ?? 0) + value;
  }

  for (const row of rows) {
    if (!row.month_year) continue;
    const point = pointFor(row.month_year);

    for (const [seriesKey, column] of Object.entries(SERIES_COLUMNS)) {
      const value = columnValue(row, column, metric);
      if (value != null) point[seriesKey] = (point[seriesKey] ?? 0) + value;
    }

    if (row.current_source_model) {
      point.currentModels[row.current_source_model] =
        (point.currentModels[row.current_source_model] ?? 0) + 1;
    }

    if (singleSeries) {
      const low = columnValue(row, 'current_low_80', metric);
      const high = columnValue(row, 'current_high_80', metric);
      point.range = low != null && high != null ? [low, high] : null;
      point.confidenceBand = row.current_confidence_band;
      point.backtestSmape = row.current_backtest_smape;
      point.promoMix = row.promo_mix;
      point.realisedPrice = row.realised_price;
    }
  }

  return [...byMonth.values()].sort((a, b) => a.month_year.localeCompare(b.month_year));
}

/**
 * "Tier 1 advanced" for one SKU, or "Tier 1 advanced ×7 · Tier 0 baseline ×2"
 * when a month's total mixes SKUs forecast by different tiers. Counts are
 * grouped by label, so the two Tier 1 models add up to one entry.
 */
export function formatModelMix(currentModels) {
  const countsByLabel = {};
  for (const [model, count] of Object.entries(currentModels ?? {})) {
    const label = sourceModelLabel(model);
    countsByLabel[label] = (countsByLabel[label] ?? 0) + count;
  }
  const entries = Object.entries(countsByLabel);
  if (!entries.length) return '';
  if (entries.length === 1 && entries[0][1] === 1) return entries[0][0];
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} ×${count}`)
    .join(' · ');
}

/**
 * The "why" behind a month's Current value, for the tooltip and promo panel:
 * which model produced it, how accurate that model was in its backtest, and
 * what it assumed about promotions.
 */
export function forecastPointDetails(point, metric, formatValue) {
  if (!point) return [];
  const details = [];
  const models = formatModelMix(point.currentModels);
  if (models) details.push({ label: 'Model', value: models });
  if (point.range) {
    details.push({
      label: '80% range',
      value: `${formatValue(point.range[0])} – ${formatValue(point.range[1])}`,
    });
  }
  if (point.confidenceBand) {
    const smape = point.backtestSmape == null ? '' : ` (sMAPE ${point.backtestSmape.toFixed(1)})`;
    details.push({ label: 'Confidence', value: `${point.confidenceBand}${smape}` });
  }
  if (point.promoMix) {
    details.push({ label: 'Promo', value: PROMO_MIX_LABELS[point.promoMix] ?? point.promoMix });
  }
  if (metric === 'revenue' && point.realisedPrice != null) {
    details.push({ label: 'Price', value: `$${point.realisedPrice.toFixed(2)} / carton` });
  }
  return details;
}

export function emptyMonthlyPoint(monthYear) {
  return {
    month_year: monthYear,
    label: formatMonthLabel(monthYear),
    actual: null,
    initial: null,
    previous: null,
    current: null,
    range: null,
    currentModels: {},
    confidenceBand: null,
    backtestSmape: null,
    promoMix: null,
    realisedPrice: null,
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

// The Current line only ever covers the 12 months after the newest sales
// month, so its sum is the 12-month total. (A partly loaded month can have
// both an actual and a forecast; the forecast still counts.)
export function sumHorizonForecast(points) {
  return points.reduce((total, point) => {
    if (point.current == null) return total;
    return total + point.current;
  }, 0);
}

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
    const hasData =
      point.actual != null ||
      point.initial != null ||
      point.previous != null ||
      point.current != null;
    if (!hasData || !point.month_year || seen.has(point.month_year)) return [];
    seen.add(point.month_year);
    return [{ value: point.month_year, label: point.label }];
  });
}

