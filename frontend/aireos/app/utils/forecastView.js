import { splitPromoType } from '@/app/utils/promotionForm';

export const DEFAULT_PRODUCT_NAME = 'Aire Ultra Tape L';

export const FORECAST_SERIES = [
  { key: 'actual', label: 'Actual', color: '#3A4369', dash: undefined, shape: 'circle' },
  // A frozen Jan-Dec baseline per calendar year -- generated once from prior-year
  // data only and never recomputed, unlike previous/current below which are
  // "rolling" 12-month-ahead runs regenerated monthly. See
  // pl_forecast.next_yearly_run / runs_to_compute for what "frozen" means here.
  { key: 'initial', label: 'Initial Yearly Forecast', color: '#E8922A', dash: '2 4', shape: 'square' },
  { key: 'previous', label: 'Previous', color: '#7C3AED', dash: '8 3', shape: 'triangle' },
  { key: 'current', label: 'Current', color: '#0D9488', dash: '3 3', shape: 'diamond' },
];

export const ALL_SERIES_VISIBLE = Object.fromEntries(
  FORECAST_SERIES.map((series) => [series.key, true])
);

export const FORECAST_TIERS = [
  { value: 1, label: 'Tier 1' },
  { value: 0, label: 'Tier 0' },
];

export const DEFAULT_FORECAST_TIER = 1;

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

function predictedValue(row, metric) {
  if (metric === 'revenue') return row.predicted_revenue;
  return row.predicted_quantity_units;
}

export function getRunDates(rows) {
  // Yearly baselines are excluded here -- they can share a date with a
  // rolling run (see backend forecasting_output_schema.sql) and aren't part
  // of the previous/current rotation at all (they're shown as "Initial
  // Yearly Forecast" instead -- see buildMonthlyPoints).
  const dates = [
    ...new Set(
      rows.filter((row) => row.run_type !== 'yearly').map((row) => row.forecast_generated_at).filter(Boolean)
    ),
  ].sort();
  return {
    previous: dates.length >= 3 ? dates.at(-2) : null,
    current: dates.at(-1) ?? null,
  };
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

export function buildMonthlyPoints(rows, actuals = [], metric = 'units') {
  const { previous, current } = getRunDates(rows);
  const byMonth = new Map();

  function pointFor(monthYear) {
    if (!byMonth.has(monthYear)) {
      byMonth.set(monthYear, {
        month_year: monthYear,
        label: formatMonthLabel(monthYear),
        actual: null,
        initial: null,
        previous: null,
        current: null,
      });
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
    const point = pointFor(row.month_year);

    if (row.run_type === 'yearly') {
      // The frozen yearly baseline is shown as "Initial Yearly Forecast" --
      // at most one yearly-run row ever covers a given month, so this just
      // accumulates, no previous/current-style date matching needed.
      const value = predictedValue(row, metric);
      if (value != null) point.initial = (point.initial ?? 0) + value;
      continue;
    }

    const value = predictedValue(row, metric);
    if (value == null) continue;

    if (row.forecast_generated_at === current) {
      point.current = (point.current ?? 0) + value;
    }
    if (row.forecast_generated_at === previous) {
      point.previous = (point.previous ?? 0) + value;
    }
  }

  return [...byMonth.values()].sort((a, b) => a.month_year.localeCompare(b.month_year));
}

export function emptyMonthlyPoint(monthYear) {
  return {
    month_year: monthYear,
    label: formatMonthLabel(monthYear),
    actual: null,
    initial: null,
    previous: null,
    current: null,
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

export function sumHorizonForecast(points) {
  return points.reduce((total, point) => {
    if (point.actual != null || point.current == null) return total;
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

