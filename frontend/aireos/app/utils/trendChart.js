// Pure helpers shared by the sales dashboard's trend charts
// (RevenueTrendCard, ComparisonMixChart): bucket labels, axis setup, bar
// sizing and format stack order. No React.

import { axisTickFormatter } from '@/app/utils/axisTicks';
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
// so the axis is drawn by month instead (weekMonthGroups + MonthAxis). The
// tooltip still gives each week's own dates.
const MAX_LABELLED_WEEKS = 13;

/**
 * For a long run of weeks, the weeks grouped by the month they start in, in
 * order: [{ label, values }], `values` being the rows' `displayLabel`s (the
 * x-axis categories), each labelled with its year ("Feb 2026") so every label
 * reads the same way. A week belongs to the month it starts in, so a month is
 * 4 or 5 weeks wide: the spacing follows the calendar. Null for months, or a
 * short run of weeks, which label each bar instead (periodAxisProps).
 *
 * @param {Array<{ periodStart: string, displayLabel: string }>} rows
 * @param {'week' | 'month'} granularity
 * @returns {Array<{ label: string, values: string[] }> | null}
 */
export function weekMonthGroups(rows, granularity) {
  if (granularity !== 'week' || rows.length <= MAX_LABELLED_WEEKS) return null;
  const groups = [];
  for (const row of rows) {
    const month = String(row.periodStart).slice(0, 7);
    const last = groups.at(-1);
    if (last?.month === month) {
      last.values.push(row.displayLabel);
      continue;
    }
    groups.push({ month, label: bucketLabel('month', row.periodStart), values: [row.displayLabel] });
  }
  return groups.map(({ label, values }) => ({ label, values }));
}

// Up to this many month labels sit flat under a long week run; more tilt 45°
// so every month keeps its label -- the same rule as the By month view
// (xAxisProps), so both views read alike.
const MAX_FLAT_MONTH_LABELS = 6;

/**
 * Whether MonthAxis tilts its month labels (more than MAX_FLAT_MONTH_LABELS).
 *
 * @param {Array<object>} groups weekMonthGroups
 */
export function monthLabelsTilted(groups) {
  return groups.length > MAX_FLAT_MONTH_LABELS;
}

// Room under the plot for MonthAxis' week marks and flat month labels.
const MONTH_AXIS_HEIGHT = 30;

/**
 * xAxisProps for a chart with one point per period, from its rows (in date
 * order, each with `periodStart`). A long run of weeks hides the axis' own
 * labels and leaves room for MonthAxis, which the chart draws from
 * weekMonthGroups: flat, or tilted with the tilted height and `angle` (which
 * the charts read to make room on the left for the first label; the axis
 * itself draws no labels).
 *
 * @param {Array<{ periodStart: string }>} rows
 * @param {'week' | 'month'} granularity
 */
export function periodAxisProps(rows, granularity) {
  if (granularity !== 'week' || rows.length <= MAX_LABELLED_WEEKS) return xAxisProps(rows.length, granularity);
  const hidden = { interval: 0, tick: false, tickLine: false };
  if (!monthLabelsTilted(weekMonthGroups(rows, granularity))) return { ...hidden, height: MONTH_AXIS_HEIGHT };
  return { ...hidden, angle: -45, height: tiltedAxisHeight('month') };
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

// The charts' Revenue / Volume switch: 'revenue' or 'units'.
export function formatMetric(metric, value) {
  return metric === 'units' ? formatUnits(value) : formatRevenue(value);
}

// The y-axis has this many equal steps above 0 (5 ticks, Recharts' default).
const AXIS_STEPS = 4;
// Step sizes that still read well as labels (1.5k, 6k, 2.5M ...), times a
// power of ten. Finer than 1/2/5 alone, which could nearly double the axis.
const NICE_STEP_FACTORS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
// Room above the tallest value, as a share of it.
const HEADROOM = 1.05;

/**
 * The top of a chart's y-axis: at least 5% above the tallest bar, stack or
 * point, so the highest value never sits on the plot's top edge (where a
 * line's point and dot are clipped off), and a whole number of equal, round
 * steps (AXIS_STEPS), so every tick is the same distance apart. Recharts
 * puts its last tick on the axis top, so a top that is not a whole step
 * (e.g. 24.1k after ticks of 6.5k) would leave a short last gap.
 *
 * @param {number} dataMax
 * @returns {number}
 */
export function niceAxisMax(dataMax) {
  if (!(dataMax > 0)) return 1;
  const rawStep = (dataMax * HEADROOM) / AXIS_STEPS;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const factor = NICE_STEP_FACTORS.find((f) => f * magnitude >= rawStep);
  // toPrecision drops float noise (1.2 * 0.1 is 0.12000000000000001).
  return Number((factor * magnitude * AXIS_STEPS).toPrecision(12));
}

/**
 * The tallest value a chart draws: the biggest of `rows`' summed `keys`
 * (a stacked bar adds its segments; pass one key per row for a line or a
 * grouped bar via `stacked: false`). Missing values count as 0.
 *
 * @param {Array<object>} rows
 * @param {string[]} keys
 * @param {{ stacked?: boolean }} [options]
 */
export function chartDataMax(rows, keys, { stacked = true } = {}) {
  let max = 0;
  for (const row of rows) {
    const values = keys.map((key) => Number(row[key]) || 0);
    const value = stacked ? values.reduce((sum, v) => sum + v, 0) : Math.max(0, ...values);
    if (value > max) max = value;
  }
  return max;
}

/**
 * The y-axis of every dashboard trend chart, spread onto <YAxis>: 0 to
 * niceAxisMax(dataMax) in AXIS_STEPS equal steps, each tick labelled in one
 * unit with one number of decimals (axisTickFormatter): $0, $0.8k, $1.6k ...
 * The ticks are given outright, so they are exactly the steps the labels
 * were chosen for.
 *
 * @param {'revenue' | 'units'} metric
 * @param {number} dataMax the tallest value drawn (chartDataMax)
 */
export function metricYAxisProps(metric, dataMax) {
  const top = niceAxisMax(dataMax);
  const ticks = Array.from({ length: AXIS_STEPS + 1 }, (_, i) => Number(((top / AXIS_STEPS) * i).toPrecision(12)));
  return {
    domain: [0, top],
    ticks,
    tickFormatter: axisTickFormatter(top, AXIS_STEPS, metric === 'units' ? '' : '$'),
    width: 50,
    tick: { fontSize: 10 },
  };
}

// Room above the plot for the top tick label and a point's hover dot.
export const CHART_TOP_MARGIN = 12;

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

// Past this many points a dot on every one crowds a line chart; the hovered
// point still gets one (activeDot). Shared by the dashboard's line charts.
export const MAX_DOTTED_POINTS = 26;

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
