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

export const PROMO_OVERLAY_TYPES = [
  {
    value: 'regular',
    label: 'Regular',
    color: '#DFE4F7',
    swatch: '#3A4369',
    strokeColor: '#3A4369',
    fillOpacity: 0.55,
    strokeOpacity: 0.16,
    badgeClass: 'border-deep-violet-blue/20 bg-lavander text-deep-violet-blue',
  },
  {
    value: 'bundle',
    label: 'Bundle',
    color: '#A29BCC',
    swatch: '#A29BCC',
    fillOpacity: 0.18,
    strokeOpacity: 0.22,
    badgeClass: 'border-violet/40 bg-violet/15 text-deep-violet-blue',
  },
  {
    value: 'side_offer',
    label: 'Side offer',
    color: '#A7D2F2',
    swatch: '#A7D2F2',
    fillOpacity: 0.22,
    strokeOpacity: 0.24,
    badgeClass: 'border-celest/50 bg-celest/20 text-deep-violet-blue',
  },
  {
    value: 'carton',
    label: 'Carton',
    color: '#EAE4DE',
    swatch: '#C4B6A6',
    strokeColor: '#C4B6A6',
    fillOpacity: 0.85,
    strokeOpacity: 0.28,
    badgeClass: 'border-violet/30 bg-cream text-deep-violet-blue',
  },
];

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
  return row.quantity_units == null ? null : row.quantity_units;
}

function predictedValue(row, metric) {
  if (metric === 'revenue') return row.predicted_revenue;
  return row.predicted_quantity_units;
}

// Resolves which row wins per forecast cell for the selected tier, so
// buildMonthlyPoints never has to know tiers exist at all. Tier 0 is this
// app's own model (see backend pl_forecast.py) and is always fully
// populated. Tier 1 is a teammate's separate model (see backend
// forecasting_output_schema.sql) -- when selected, a cell shows its Tier 1
// value if one exists, else falls back to Tier 0. Simple presence fallback,
// no accuracy comparison.
export function resolveTier(rows, tier) {
  if (tier !== 1) {
    return rows.filter((row) => row.forecast_generated_at == null || (row.tier ?? 0) === 0);
  }

  const actuals = rows.filter((row) => row.forecast_generated_at == null);
  const byCell = new Map();
  for (const row of rows) {
    if (row.forecast_generated_at == null) continue;
    const cellKey = [row.run_type, row.forecast_generated_at, row.product_name, row.customer_name, row.month_year]
      .join('|');
    const rowTier = row.tier ?? 0;
    const current = byCell.get(cellKey);
    if (!current || rowTier > current.tier) {
      byCell.set(cellKey, { row, tier: rowTier });
    }
  }
  return [...actuals, ...[...byCell.values()].map((entry) => entry.row)];
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

function applyPromoToPoint(point, row) {
  if (row.period_label && !point.period_label) point.period_label = row.period_label;
  if (row.voucher && !point.voucher) point.voucher = row.voucher;
  if (!row.promo_type) return;
  if (!point.promoByType[row.promo_type]) {
    point.promoByType[row.promo_type] = {
      promotion_mechanic: row.promotion_mechanic || null,
      period_label: row.period_label || null,
      voucher: row.voucher || null,
      productNames: new Set(),
    };
  }
  if (row.product_name) {
    point.promoByType[row.promo_type].productNames.add(row.product_name);
  }
  point.promo_types.add(row.promo_type);
  if (point.promo_types.size === 1) {
    point.promo_type = row.promo_type;
    if (row.promotion_mechanic) point.promotion_mechanic = row.promotion_mechanic;
  } else {
    point.promo_type = 'Mixed';
    point.promotion_mechanic = null;
  }
}

export function buildMonthlyPoints(rows, metric = 'units') {
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
        promotion_mechanic: null,
        promo_type: null,
        promo_types: new Set(),
        promoByType: {},
      });
    }
    return byMonth.get(monthYear);
  }

  for (const row of rows) {
    const point = pointFor(row.month_year);
    applyPromoToPoint(point, row);

    if (row.forecast_generated_at == null) {
      const value = actualValue(row, metric);
      if (value != null) point.actual = (point.actual ?? 0) + value;
      continue;
    }

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
      if (row.promotion_mechanic) point.promotion_mechanic = row.promotion_mechanic;
    }
    if (row.forecast_generated_at === previous) {
      point.previous = (point.previous ?? 0) + value;
      if (!point.promotion_mechanic && row.promotion_mechanic) {
        point.promotion_mechanic = row.promotion_mechanic;
      }
    }
  }

  return [...byMonth.values()]
    .sort((a, b) => a.month_year.localeCompare(b.month_year))
    .map(({ promo_types, promoByType, ...point }) => ({
      ...point,
      promoTypes: [...promo_types],
      promoByType: Object.fromEntries(
        Object.entries(promoByType).map(([type, details]) => [
          type,
          {
            ...details,
            productNames: [...(details.productNames ?? [])].sort(),
          },
        ])
      ),
    }));
}

export function emptyMonthlyPoint(monthYear) {
  return {
    month_year: monthYear,
    label: formatMonthLabel(monthYear),
    actual: null,
    initial: null,
    previous: null,
    current: null,
    promotion_mechanic: null,
    promo_type: null,
    promoTypes: [],
    promoByType: {},
  };
}

// Default date range for the Forecast page: the current calendar year only,
// clamped to whatever data actually exists (so a bound of '' or a range that
// doesn't reach this year still returns something sane). Past years (2024,
// 2025, ...) only show once the user explicitly widens the date filter --
// ISO 'YYYY-MM-DD' strings compare lexicographically the same as
// chronologically, so plain string comparison is enough here.
export function currentYearDateRange(bounds = {}) {
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return {
    start: bounds.start && bounds.start > yearStart ? bounds.start : yearStart,
    end: bounds.end && bounds.end < yearEnd ? bounds.end : yearEnd,
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

export function monthHasPromoType(point, promoType) {
  if (!promoType || !point) return false;
  return point.promoTypes?.includes(promoType) || point.promo_type === promoType;
}

export function overlayBandsForPromo(points, promoType) {
  if (!promoType || !points.length) return [];

  const runs = [];
  for (let index = 0; index < points.length; index += 1) {
    if (!monthHasPromoType(points[index], promoType)) continue;
    const currentRun = runs.at(-1);
    if (currentRun && index === currentRun.endIndex + 1) {
      currentRun.endIndex = index;
      continue;
    }
    runs.push({ startIndex: index, endIndex: index });
  }

  return runs.map((run) => ({
    x1: run.startIndex,
    x2: run.endIndex + 1,
  }));
}

export function overlayMonthDividers(points, promoType) {
  const xs = new Set();
  for (const band of overlayBandsForPromo(points, promoType)) {
    for (let x = band.x1; x <= band.x2; x += 1) {
      xs.add(x);
    }
  }
  return [...xs].sort((a, b) => a - b);
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
  const next = { ...visible, [key]: !visible[key] };
  if (!Object.values(next).some(Boolean)) return visible;
  return next;
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

export function uniquePromoOptions(points) {
  return [
    ...new Set(points.flatMap((point) => point.promoTypes ?? []).filter(Boolean)),
  ].sort();
}
