'use client';

import { CartesianGrid, ComposedChart, Dot, Line, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

import { FORECAST_SERIES } from '@/app/utils/forecastView';
import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { dotRevealDelay, lineSweepTimings } from '@/app/utils/lineAnimation';

import { labelledTooltipRow } from './chartTooltip';

// The sell-out lines look exactly like the Forecast page's Actual, Initial
// Yearly Forecast, Previous and Current lines (forecastView.FORECAST_SERIES), so the two
// pages read the same way.
const FORECAST_LINE = Object.fromEntries(FORECAST_SERIES.map((series) => [series.key, series]));

// Sell-in is one colour, solid while actual and dashed once it is the plan's
// recommendation, the same way sell-out runs from actual into forecast.
const SELL_IN_COLOR = 'var(--aire-violet)';
const SELL_IN_PLAN_DASH = '6 4';

// `dot`: the line has a dot per month (the actual lines), so its legend sample does too.
const SERIES = [
  { key: 'sell_in_actual', label: 'Sell-in (actual)', color: SELL_IN_COLOR, dot: true },
  { key: 'sell_in_recommended', label: 'Sell-in (recommended)', color: SELL_IN_COLOR, dash: SELL_IN_PLAN_DASH },
  {
    key: 'sell_out_actual',
    label: 'Sell-out (actual)',
    color: FORECAST_LINE.actual.color,
    dot: true,
  },
  {
    key: 'sell_out_current',
    label: 'Sell-out Forecast (Current)',
    color: FORECAST_LINE.current.color,
    dash: FORECAST_LINE.current.dash,
  },
  {
    // Last month's forecast run, so last month's sales can be read against what
    // was forecast for them a month ahead (backend get_forecast_lines "previous").
    key: 'sell_out_previous',
    label: 'Sell-out Forecast (Previous)',
    color: FORECAST_LINE.previous.color,
    dash: FORECAST_LINE.previous.dash,
  },
  {
    key: 'sell_out_initial',
    // Named for sell-out here, beside the sell-in lines; same line as the Forecast page's Initial Yearly Forecast.
    label: 'Initial Yearly Sell-out Forecast',
    color: FORECAST_LINE.initial.color,
    dash: FORECAST_LINE.initial.dash,
  },
];

/**
 * A legend sample of one line, drawn the way the chart draws it, so two lines
 * in the same colour (sell-in actual and recommended) still tell apart. Sized
 * inline: ChartLegendContent squares any icon to 12px by class.
 *
 * `faded`: the line has no values in view, so its entry is greyed out.
 *
 * @param {{ color: string, dash?: string, dot?: boolean }} series
 * @param {boolean} [faded]
 */
function legendLine({ color, dash, dot }, faded = false) {
  return function LegendLine() {
    return (
      <svg viewBox="0 0 22 10" style={{ width: 22, height: 10, opacity: faded ? 0.35 : 1 }} aria-hidden="true">
        <line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth="2" strokeDasharray={dash} />
        {dot ? <circle cx="11" cy="5" r="2.5" fill="#fff" stroke={color} strokeWidth="1.5" /> : null}
      </svg>
    );
  };
}

const CHART_CONFIG = Object.fromEntries(
  SERIES.map((series) => [series.key, { label: series.label, color: series.color, icon: legendLine(series) }]),
);

// Until the forecast pipeline has a second run there is no Previous forecast;
// the legend still lists it with its sample greyed out, so it is clear the line
// is missing, not hidden (the Forecast page greys its Previous pill out too).
const PREVIOUS_SERIES = SERIES.find((series) => series.key === 'sell_out_previous');
const CHART_CONFIG_NO_PREVIOUS = {
  ...CHART_CONFIG,
  sell_out_previous: { ...CHART_CONFIG.sell_out_previous, icon: legendLine(PREVIOUS_SERIES, true) },
};

const TOOLTIP_CONFIG = Object.fromEntries(SERIES.map((series) => [series.key, { label: series.label }]));

const TOOLTIP_ORDER = SERIES.map((series) => series.key);

// Each line sweeps left to right: the actual parts first, then the
// recommendation and the current forecast carry on from where they ended.
// The initial and previous run across the whole window.
const LINE_SWEEP = { begin: 0, duration: 1200 };

// The dashed lines that start from the last actual point (see rows below).
const JOIN_KEYS = ['sell_in_recommended', 'sell_out_current'];

// Recharts' dot, faded in as the line reaches it (dotRevealDelay). `points` is
// the whole line, which is not a valid attribute for one circle.
function timedDot(timing) {
  return function TimedDot({ points, ...dotProps }) {
    const delay = dotRevealDelay(timing, points, dotProps.cx);
    return <Dot {...dotProps} className="line-dot-in" style={{ animationDelay: `${delay}ms` }} />;
  };
}

/**
 * The plan months that run on the Initial Yearly Forecast because the current
 * forecast does not reach them yet, as a label ("Aug 2026 – Sep 2026"), or null.
 *
 * @param {Array<{ month: string, forecast_source: string | null }>} months
 * @returns {string | null}
 */
export function initialFallbackLabel(months) {
  const fallback = months.filter((row) => row.forecast_source === 'initial' || row.forecast_source === 'mixed');
  if (fallback.length === 0) return null;
  const first = formatMonth(fallback[0].month);
  const last = formatMonth(fallback[fallback.length - 1].month);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Sell-in against sell-out by month for the sell-in plan, all as lines. Sell-in
 * is solid through the actual months and dashed for the plan's recommendation.
 * Sell-out is the actual line, the current forecast carrying on from it, and the
 * Initial Yearly Forecast and last month's (Previous) forecast across the whole
 * window, so last months' sales can be read against what was planned for them. A plan month the current forecast
 * does not reach runs on the initial, and is drawn on that line only.
 * `actualsThrough` is the last actual month.
 *
 * @param {{ months: Array<{ month: string, sell_in_actual: number | null, sell_in_recommended: number | null, sell_out_actual: number | null, sell_out_forecast: number | null, sell_out_initial: number | null, sell_out_previous: number | null, forecast_source: 'current' | 'initial' | 'mixed' | null }>, actualsThrough: string | null }} props
 */
export default function SellInOutlookChart({ months, actualsThrough }) {
  if (months.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No actuals for these filters.</p>;
  }

  const lastIndex = months.findIndex((row) => row.month === actualsThrough);
  const nextIsCurrent = ['current', 'mixed'].includes(months[lastIndex + 1]?.forecast_source);
  const rows = months.map((row, index) => ({
    ...row,
    label: formatMonth(row.month),
    // The recommendation starts from the last actual point so the sell-in line
    // reads as one stroke from actual into plan.
    sell_in_recommended: index === lastIndex ? row.sell_in_actual : row.sell_in_recommended,
    // The current line does the same, when the month after it is on the current forecast.
    sell_out_current:
      index === lastIndex && nextIsCurrent
        ? row.sell_out_actual
        : row.forecast_source === 'current' || row.forecast_source === 'mixed'
          ? row.sell_out_forecast
          : null,
  }));

  const timings = lineSweepTimings(
    rows,
    ['sell_in_actual', 'sell_in_recommended', 'sell_out_actual', 'sell_out_current', 'sell_out_previous', 'sell_out_initial'],
    LINE_SWEEP,
  );

  const formatRow = labelledTooltipRow(TOOLTIP_CONFIG, (value) => `${formatUnits(value)} units`);
  function formatTooltipRow(value, name, item, index, payload) {
    // The join point repeats the actual value on the dashed lines; it is not a plan or forecast.
    if (JOIN_KEYS.includes(name) && payload?.month === actualsThrough) return null;
    return formatRow(value, name, item);
  }

  const fallback = initialFallbackLabel(months);
  const hasPrevious = months.some((row) => row.sell_out_previous != null);

  return (
    <div className="space-y-2">
      <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
        <ChartContainer config={hasPrevious ? CHART_CONFIG : CHART_CONFIG_NO_PREVIOUS} className="aspect-auto h-[328px] w-full">
          <ComposedChart accessibilityLayer data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--aire-lavender)" />
            <XAxis
              dataKey="label"
              interval={0}
              height={52}
              tick={{ fontSize: 9, fill: '#3A4369' }}
              angle={-40}
              textAnchor="end"
              tickMargin={6}
            />
            <YAxis width={48} tick={{ fontSize: 10, fill: '#3A4369' }} tickFormatter={formatUnits} />
            {/* Above the legend, which is drawn after it and would show through. */}
            <ChartTooltip
              wrapperStyle={{ zIndex: 10 }}
              itemSorter={(item) => TOOLTIP_ORDER.indexOf(item.dataKey)}
              content={
                <ChartTooltipContent
                  className="border-violet/40 bg-white"
                  formatter={formatTooltipRow}
                />
              }
            />
            <ChartLegend itemSorter={null} content={<ChartLegendContent className="flex-wrap text-foreground" />} />
            <Line
              dataKey="sell_in_actual"
              stroke="var(--color-sell_in_actual)"
              strokeWidth={2}
              dot={timedDot(timings.sell_in_actual)}
              connectNulls={false}
              {...timings.sell_in_actual}
            />
            <Line
              dataKey="sell_in_recommended"
              stroke="var(--color-sell_in_recommended)"
              strokeWidth={2}
              strokeDasharray={SELL_IN_PLAN_DASH}
              dot={false}
              connectNulls={false}
              {...timings.sell_in_recommended}
            />
            <Line
              dataKey="sell_out_initial"
              stroke="var(--color-sell_out_initial)"
              strokeWidth={2}
              strokeDasharray={FORECAST_LINE.initial.dash}
              dot={false}
              connectNulls={false}
              {...timings.sell_out_initial}
            />
            <Line
              dataKey="sell_out_actual"
              stroke="var(--color-sell_out_actual)"
              strokeWidth={2}
              dot={timedDot(timings.sell_out_actual)}
              connectNulls={false}
              {...timings.sell_out_actual}
            />
            <Line
              dataKey="sell_out_previous"
              stroke="var(--color-sell_out_previous)"
              strokeWidth={2}
              strokeDasharray={FORECAST_LINE.previous.dash}
              dot={false}
              connectNulls={false}
              {...timings.sell_out_previous}
            />
            <Line
              dataKey="sell_out_current"
              stroke="var(--color-sell_out_current)"
              strokeWidth={2}
              strokeDasharray={FORECAST_LINE.current.dash}
              dot={false}
              connectNulls={false}
              {...timings.sell_out_current}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
      {fallback ? (
        <p className="text-[11px] text-deep-violet-blue/60">
          {fallback}: no current forecast yet, so the plan uses the Initial Yearly Sell-out Forecast for{' '}
          {fallback.includes('–') ? 'these months' : 'this month'}.
        </p>
      ) : null}
    </div>
  );
}
