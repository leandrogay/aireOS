'use client';

import { Bar, CartesianGrid, ComposedChart, Dot, Line, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { BAR_ANIMATION } from '@/app/utils/trendChart';

import { labelledTooltipRow } from './chartTooltip';

const SELL_OUT_COLOR = '#E8922A';

const SERIES = [
  { key: 'sell_in_actual', label: 'Sell-in (actual)', color: 'var(--aire-deep-blue)' },
  { key: 'sell_in_recommended', label: 'Sell-in (recommended)', color: 'var(--aire-violet)' },
  { key: 'sell_out_actual', label: 'Sell-out (actual)', color: SELL_OUT_COLOR },
  { key: 'sell_out_forecast', label: 'Sell-out (forecast)', color: SELL_OUT_COLOR },
];

const LEGEND = [
  SERIES[0],
  SERIES[1],
  { key: 'sell_out', label: 'Sell-out', color: SELL_OUT_COLOR },
];

const chartConfig = Object.fromEntries(
  SERIES.map((series) => [series.key, { label: series.label, color: series.color }]),
);

const TOOLTIP_ORDER = SERIES.map((series) => series.key);

// The sell-out line draws in after the bars have started growing (BAR_ANIMATION
// is 800 ms): the solid actual part first, then the dashed forecast carries on
// from where it ended, so the line reads as one stroke from actual into plan.
const LINE_BEGIN_MS = 500;
const LINE_DRAW_MS = 900;

// Positions of the first and last row that have a value for `key`, or null.
function indexRange(rows, key) {
  const indexes = rows.flatMap((row, index) => (row[key] == null ? [] : [index]));
  return indexes.length ? { first: indexes[0], last: indexes[indexes.length - 1] } : null;
}

// Splits LINE_DRAW_MS between the two lines in proportion to the months each
// covers, so the pen moves at one speed across the join. Linear easing for the
// same reason: easing each line separately would slow down and restart there.
function lineTimings(rows) {
  const actual = indexRange(rows, 'sell_out_actual');
  const forecast = indexRange(rows, 'sell_out_forecast');
  const start = actual?.first ?? forecast?.first ?? 0;
  const end = forecast?.last ?? actual?.last ?? 0;
  const span = Math.max(end - start, 1);
  const actualMs = actual ? (LINE_DRAW_MS * (actual.last - actual.first)) / span : 0;
  const forecastMs = forecast ? (LINE_DRAW_MS * (forecast.last - forecast.first)) / span : 0;
  return {
    actual: { animationBegin: LINE_BEGIN_MS, animationDuration: Math.max(actualMs, 1), animationEasing: 'linear' },
    forecast: {
      animationBegin: LINE_BEGIN_MS + actualMs,
      animationDuration: Math.max(forecastMs, 1),
      animationEasing: 'linear',
    },
  };
}

// A line's dots are drawn at once, ahead of the line. This one fades in
// (.line-dot-in, globals.css) just as the line reaches it, timed from its
// place along the line. Dot props are Recharts' own, `points` being the whole
// line, which is not a valid attribute for one circle.
function timedDot(timing) {
  return function TimedDot({ points, ...dotProps }) {
    const drawn = points.filter((point) => point.y != null);
    const width = drawn.length > 1 ? drawn[drawn.length - 1].x - drawn[0].x : 0;
    const progress = width > 0 ? (dotProps.cx - drawn[0].x) / width : 0;
    const delay = timing.animationBegin + timing.animationDuration * progress;
    return <Dot {...dotProps} className="line-dot-in" style={{ animationDelay: `${Math.round(delay)}ms` }} />;
  };
}

/**
 * Sell-in against sell-out by month for the sell-in plan. Sell-in bars are the
 * actual months and the plan's recommended sell-in, stacked per month; sell-out
 * is a solid line through the actual months, continued dashed by the forecast.
 * `actualsThrough` is the last actual month, where the two sell-out lines meet.
 *
 * @param {{ months: Array<{ month: string, sell_in_actual: number | null, sell_in_recommended: number | null, sell_out_actual: number | null, sell_out_forecast: number | null }>, actualsThrough: string | null }} props
 */
export default function SellInOutlookChart({ months, actualsThrough }) {
  if (months.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No actuals for these filters.</p>;
  }

  // The forecast line starts from the last actual point so the two sell-out lines join.
  const rows = months.map((row) => ({
    ...row,
    label: formatMonth(row.month),
    sell_out_forecast: row.month === actualsThrough ? row.sell_out_actual : row.sell_out_forecast,
  }));

  const timings = lineTimings(rows);

  const formatRow = labelledTooltipRow(chartConfig, (value) => `${formatUnits(value)} units`);
  // The join point repeats the actual value on the forecast line; it is not a forecast.
  function formatTooltipRow(value, name, item, index, payload) {
    if (name === 'sell_out_forecast' && payload?.month === actualsThrough) return null;
    return formatRow(value, name, item);
  }

  return (
    <div className="space-y-2">
      <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
        <ChartContainer config={chartConfig} className="aspect-auto h-[300px] w-full">
          <ComposedChart accessibilityLayer data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
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
            <ChartTooltip
              itemSorter={(item) => TOOLTIP_ORDER.indexOf(item.dataKey)}
              content={
                <ChartTooltipContent
                  className="border-violet/40 bg-white"
                  formatter={formatTooltipRow}
                />
              }
            />
            <Bar dataKey="sell_in_actual" stackId="sell-in" fill="var(--color-sell_in_actual)" {...BAR_ANIMATION} />
            <Bar
              dataKey="sell_in_recommended"
              stackId="sell-in"
              fill="var(--color-sell_in_recommended)"
              radius={[2, 2, 0, 0]}
              {...BAR_ANIMATION}
            />
            <Line
              dataKey="sell_out_actual"
              stroke="var(--color-sell_out_actual)"
              strokeWidth={2}
              dot={timedDot(timings.actual)}
              connectNulls={false}
              isAnimationActive="auto"
              {...timings.actual}
            />
            <Line
              dataKey="sell_out_forecast"
              stroke="var(--color-sell_out_forecast)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls={false}
              isAnimationActive="auto"
              {...timings.forecast}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-deep-violet-blue">
        {LEGEND.map((series) => (
          <span key={series.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: series.color }} />
            {series.label}
          </span>
        ))}
      </div>
    </div>
  );
}
