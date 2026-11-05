// Pure helpers shared by the sales dashboard's trend charts
// (RevenueTrendCard, ComparisonMixChart): bucket labels, axis setup, bar
// sizing and format stack order. No React.

import { addDays, formatPeriodName, formatWeekRange, parseIso } from '@/app/utils/periodComparison';

// "Jul 2 – Jul 8" for a week, "Jan 2026" for a month. Months arrive as
// "January 2026" (see backend _dashboard_rows); the short form keeps a
// 12-month axis readable.
export function bucketLabel(granularity, periodStart) {
  if (granularity === 'week') return formatWeekRange(periodStart);
  return parseIso(periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Same bucket with its year, for tooltips, where the two sides of a
// comparison are often a year apart: "Aug 14 – Aug 20, 2026",
// "Dec 31, 2025 – Jan 6, 2026", "Jul 2026".
export function exactBucketLabel(granularity, periodStart) {
  if (granularity === 'week') return formatPeriodName(periodStart, addDays(periodStart, 6));
  return bucketLabel('month', periodStart);
}

export function displayLabelFor(periodLabel, periodStart) {
  return bucketLabel(periodLabel.startsWith('Week ') ? 'week' : 'month', periodStart);
}

// Labels are never skipped (Recharts would otherwise drop some silently: a
// YTD by month lost "Jan"); when they'd run into each other they tilt 45°
// instead. Up to 6 month labels ("Jan 2026") sit flat, and up to 2 week
// labels; a week label ("Nov 20 – Nov 26") is about as wide as a bar's slot,
// so more of them tilt. The axis is made tall enough for the tilted text,
// since Recharts clips whatever doesn't fit.
export function xAxisProps(count, granularity) {
  if (count <= (granularity === 'week' ? 2 : 6)) return { interval: 0 };
  return { interval: 0, angle: -45, textAnchor: 'end', height: tiltedAxisHeight(granularity) };
}

// Past this many weeks a label per week runs together (a year by week is 52),
// so the axis names each month once instead, under its first week. The
// tooltip still gives each week's own dates.
const MAX_LABELLED_WEEKS = 13;

/**
 * xAxisProps for a chart with one point per period, from its rows (in date
 * order, each with `periodStart`). A long run of weeks is labelled by month.
 *
 * @param {Array<{ periodStart: string }>} rows
 * @param {'week' | 'month'} granularity
 */
export function periodAxisProps(rows, granularity) {
  if (granularity !== 'week' || rows.length <= MAX_LABELLED_WEEKS) return xAxisProps(rows.length, granularity);
  let previousMonth = '';
  const labels = rows.map((row) => {
    const month = String(row.periodStart).slice(0, 7);
    if (month === previousMonth) return '';
    previousMonth = month;
    return bucketLabel('month', row.periodStart);
  });
  return {
    ...xAxisProps(labels.filter(Boolean).length, 'month'),
    tickFormatter: (_value, index) => labels[index] ?? '',
  };
}

// The comparison chart labels both bars of every bucket, which never fit
// flat side by side, so its labels are always tilted and never skipped.
export function comparisonAxisProps(granularity) {
  return { interval: 0, angle: -45, height: tiltedAxisHeight(granularity) };
}

// Room under the plot for a 45° label: about 0.7 of its width, plus the gap
// above it. Week labels are about twice as long as month labels.
function tiltedAxisHeight(granularity) {
  return granularity === 'week' ? 88 : 56;
}

// Left margin for the first tilted label, which runs down-left from its bar
// past the y-axis.
export const TILTED_LABEL_LEFT_MARGIN = 24;

export function formatAxisCurrency(value) {
  if (typeof value !== 'number') return value;
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  }
  return formatRevenue(value);
}

// A revenue figure as a price: grouped, always two decimal places.
export function formatRevenue(value) {
  return `$${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// A units figure for the charts' Volume view: grouped, whole units.
export function formatUnits(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatAxisUnits(value) {
  if (typeof value !== 'number') return value;
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  }
  return `${value}`;
}

// The charts' Revenue / Volume switch: 'revenue' or 'units'.
export function formatMetric(metric, value) {
  return metric === 'units' ? formatUnits(value) : formatRevenue(value);
}

export function metricAxisFormatter(metric) {
  return metric === 'units' ? formatAxisUnits : formatAxisCurrency;
}

// Stack order for the per-format bar: Recharts stacks <Bar> elements bottom-up
// in the order they're rendered, and that order is fixed across every bar in
// the chart (it can't vary per period) — so this picks one order for the
// whole chart, ranked by each format's total revenue across all periods
// combined, largest first. That puts the biggest, steadiest segment at the
// bottom (a stable visual base) and the smaller ones stacked on top.
export function sortFormatsByTotalDesc(periodByFormat) {
  const totals = new Map();
  for (const row of periodByFormat) {
    totals.set(row.format, (totals.get(row.format) ?? 0) + (row.revenue ?? 0));
  }
  return [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
}

// Caps how thick a bar can render — without this, Recharts stretches bars to
// fill the available width, so a chart with only one or two bars ends up with
// comically wide bars. Capping (rather than fixing) the width still lets bars
// narrow naturally as more of them need to fit, so a long range with many
// bars stays just as readable as before.
export const MAX_BAR_SIZE = 56;

// Spread onto every data <Bar> on the dashboard and inventory charts: bars grow up from 0 when a
// chart first draws, and move from their old heights to the new ones when the
// data changes. Recharts only replays when the data does, not on a hover or
// other re-render, and 'auto' skips it for prefers-reduced-motion.
export const BAR_ANIMATION = {
  isAnimationActive: 'auto',
  animationDuration: 700,
  animationEasing: 'ease-out',
};

// The chart fills whatever height the card has, never less than 220px: on
// the dashboard the card sits beside the Filters + Comparison column, which
// can be taller than the chart's own content (see page.js), and a stretched
// chart reads better than a blank band under it. aspect-auto drops the
// ChartContainer default aspect-video so the height comes from the flex.
export const CHART_SIZE_CLASS = 'aspect-auto min-h-[220px] w-full flex-1';
