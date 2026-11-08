'use client';

import { Bar, CartesianGrid, ComposedChart, Dot, Line, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { dotRevealDelay, lineSweepTimings } from '@/app/utils/lineAnimation';
import { BAR_ANIMATION, yearAxisProps } from '@/app/utils/trendChart';
import useMediaQuery from '@/hooks/useMediaQuery';

import { labelledTooltipRow } from './chartTooltip';

const SELL_OUT_COLOR = '#E8922A';

const SERIES = [
  { key: 'sell_in_actual', label: 'Sell-in (actual)', color: 'var(--aire-deep-blue)' },
  { key: 'sell_in_recommended', label: 'Sell-in (recommended)', color: 'var(--aire-violet)' },
  { key: 'sell_out_actual', label: 'Sell-out (actual)', legendLabel: 'Sell-out', color: SELL_OUT_COLOR },
  { key: 'sell_out_forecast', label: 'Sell-out (forecast)', color: SELL_OUT_COLOR },
];

// The legend shows sell-out once (the forecast line has legendType="none"), since
// both parts are one colour; the tooltip still says which part a value is.
const chartConfig = Object.fromEntries(
  SERIES.map((series) => [series.key, { label: series.legendLabel ?? series.label, color: series.color }]),
);

const TOOLTIP_CONFIG = Object.fromEntries(SERIES.map((series) => [series.key, { label: series.label }]));

const TOOLTIP_ORDER = SERIES.map((series) => series.key);

// The sell-out line draws in after the bars have started growing (BAR_ANIMATION
// is 800 ms): the solid actual part first, then the dashed forecast carries on
// from where it ended, so the line reads as one stroke from actual into plan.
const LINE_SWEEP = { begin: 500, duration: 900 };

// Recharts' dot, faded in as the line reaches it (dotRevealDelay). `points` is
// the whole line, which is not a valid attribute for one circle.
function timedDot(timing) {
  return function TimedDot({ points, ...dotProps }) {
    const delay = dotRevealDelay(timing, points, dotProps.cx);
    return <Dot {...dotProps} className="line-dot-in" style={{ animationDelay: `${delay}ms` }} />;
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
  const mobile = useMediaQuery('(max-width: 639px)');
  if (months.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No actuals for these filters.</p>;
  }

  // The forecast line starts from the last actual point so the two sell-out lines join.
  const rows = months.map((row) => ({
    ...row,
    label: formatMonth(row.month),
    sell_out_forecast: row.month === actualsThrough ? row.sell_out_actual : row.sell_out_forecast,
  }));

  const timings = lineSweepTimings(rows, ['sell_out_actual', 'sell_out_forecast'], LINE_SWEEP);

  const formatRow = labelledTooltipRow(TOOLTIP_CONFIG, (value) => `${formatUnits(value)} units`);
  // The join point repeats the actual value on the forecast line; it is not a forecast.
  function formatTooltipRow(value, name, item, index, payload) {
    if (name === 'sell_out_forecast' && payload?.month === actualsThrough) return null;
    return formatRow(value, name, item);
  }

  return (
    <div className="space-y-2">
      <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
        <ChartContainer config={chartConfig} className="aspect-auto h-[328px] w-full">
          <ComposedChart accessibilityLayer data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--aire-lavender)" />
            <XAxis
              dataKey={mobile ? 'month' : 'label'}
              interval={0}
              height={mobile ? 28 : 52}
              tick={{ fontSize: 9, fill: '#3A4369' }}
              angle={mobile ? 0 : -40}
              textAnchor={mobile ? 'middle' : 'end'}
              tickMargin={6}
              {...(mobile ? yearAxisProps(rows, 'month') : {})}
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
              dot={timedDot(timings.sell_out_actual)}
              connectNulls={false}
              {...timings.sell_out_actual}
            />
            <Line
              dataKey="sell_out_forecast"
              legendType="none"
              stroke="var(--color-sell_out_forecast)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls={false}
              {...timings.sell_out_forecast}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
    </div>
  );
}
