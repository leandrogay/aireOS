// ============================================================
// SCENARIO PITCH METRICS -- pure, no React
// ============================================================
//
// The four cards on the pitch summary (blueprint Part 2.1). They read the
// monthly points the chart plots plus the engine's per-month deltas, never
// the items, so draft promotions count the moment their source returns
// cells. Dip, gap and attainment are in units; revenue impact is in dollars.

import { formatMonthLabel } from '@/app/utils/forecastView';

function deltaFor(byMonth, monthYear, key) {
  return byMonth.get(monthYear)?.[key] ?? 0;
}

// A month still to come: it has a Current forecast and no actual yet.
function isForecastMonth(point) {
  return point.current != null && point.actual == null;
}

/**
 * Seasonal average = mean of the months in view, using the actual where
 * sales have loaded and the Current forecast otherwise (blueprint Part 4.5).
 * Null when no month has a value.
 *
 * @param {object[]} points buildMonthlyPoints output for one metric
 */
export function seasonalAverage(points) {
  const values = points
    .map((point) => (point.actual != null ? point.actual : point.current))
    .filter((value) => value != null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Every pitch-card number for the months in view.
 *
 * @param {object[]} unitPoints buildMonthlyPoints(..., 'units')
 * @param {object[]} revenuePoints buildMonthlyPoints(..., 'revenue')
 * @param {Map} byMonth simulate().byMonth
 */
export function pitchMetrics(unitPoints, revenuePoints, byMonth) {
  // Top-line revenue impact: revenue added, as a share of Current revenue in
  // the months the items cover.
  let revenueAdded = 0;
  let revenueBase = 0;
  const impactMonths = [];
  for (const point of revenuePoints) {
    const delta = deltaFor(byMonth, point.month_year, 'deltaRevenue');
    if (!delta) continue;
    revenueAdded += delta;
    revenueBase += point.current ?? 0;
    impactMonths.push(point.month_year);
  }

  // Seasonal dip flattened: in forecast months below the seasonal average,
  // the share of the gap that the items fill.
  const average = seasonalAverage(unitPoints);
  let dipTotal = 0;
  let dipFilled = 0;
  const dipMonths = [];
  for (const point of unitPoints) {
    if (average == null || !isForecastMonth(point) || point.current >= average) continue;
    const gap = average - point.current;
    dipTotal += gap;
    dipFilled += Math.min(gap, deltaFor(byMonth, point.month_year, 'deltaUnits'));
    dipMonths.push(point.month_year);
  }

  // Forecast gap closed: where Current is below the Initial Yearly Forecast,
  // the share of that shortfall the items cover.
  let shortfall = 0;
  let closed = 0;
  for (const point of unitPoints) {
    if (!isForecastMonth(point) || point.initial == null || point.current >= point.initial) continue;
    const gap = point.initial - point.current;
    shortfall += gap;
    closed += Math.min(gap, deltaFor(byMonth, point.month_year, 'deltaUnits'));
  }

  // Attainment: (actuals + forecast) / Initial Yearly Forecast, over the
  // months that have an Initial value so both sides cover the same months.
  let target = 0;
  let achieved = 0;
  let added = 0;
  for (const point of unitPoints) {
    if (point.initial == null) continue;
    target += point.initial;
    achieved += point.actual ?? point.current ?? 0;
    if (point.actual == null) added += deltaFor(byMonth, point.month_year, 'deltaUnits');
  }

  return {
    revenue: {
      added: revenueAdded,
      pctOfCurrent: revenueBase ? revenueAdded / revenueBase : null,
      months: impactMonths,
    },
    dip: {
      average,
      total: dipTotal,
      share: dipTotal ? dipFilled / dipTotal : null,
      months: dipMonths,
    },
    gap: {
      shortfall,
      share: shortfall ? closed / shortfall : null,
    },
    attainment: {
      target,
      before: target ? achieved / target : null,
      after: target ? (achieved + added) / target : null,
    },
  };
}

/**
 * "Oct 26" or "Oct 26 – Dec 26" for a sorted list of month_year values.
 *
 * @param {string[]} months
 */
export function monthSpanLabel(months) {
  if (!months.length) return '—';
  const first = formatMonthLabel(months[0]);
  const last = formatMonthLabel(months[months.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Plain-text pitch summary for the clipboard (blueprint Part 2.4): the four
 * metrics, then one line per item with its explanation as a "Why:" line.
 *
 * @param {{ scope: string, cards: { label: string, value: string, detail: string }[], unitLabel: string, items: { title: string, subtitle: string, months: string, before: string, after: string, uplift: string, explanation: string }[] }} summary
 */
export function pitchSummaryText({ scope, cards, unitLabel, items }) {
  const lines = ['PITCH SIMULATION SUMMARY', `Scope: ${scope}`, ''];
  for (const card of cards) lines.push(`• ${card.label}: ${card.value} (${card.detail})`);
  lines.push('', `Impact by building block & promotion (${unitLabel}):`);
  if (!items.length) lines.push('  – No building blocks or promotions switched on.');
  for (const item of items) {
    lines.push(`  – ${item.title} (${item.subtitle}, ${item.months}): ${item.before} → ${item.after}, ${item.uplift}`);
    if (item.explanation) lines.push(`    Why: ${item.explanation}`);
  }
  return lines.join('\n');
}

/**
 * One impact-table row per counted item, across every source (blueprint
 * Part 2.3). `totals` is the item's simulate().byItem entry, or null when the item
 * is outside the rows the page fetched -- the table then shows it labelled,
 * with no numbers, and leaves it out of the "All items" total.
 *
 * @param {Record<string, object[]>} items per source, e.g. { blocks, promotions }
 * @param {object[]} sources SCENARIO_SOURCES
 * @param {Map} byItem simulate().byItem
 */
export function impactRows(items, sources, byItem) {
  return sources.flatMap((source) =>
    (items[source.itemsKey] ?? []).map((item) => ({
      key: item.id,
      sourceLabel: source.label,
      ...source.describe(item),
      totals: byItem.get(item.id) ?? null,
    }))
  );
}
