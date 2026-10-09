'use client';

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';

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
            <Bar dataKey="sell_in_actual" stackId="sell-in" fill="var(--color-sell_in_actual)" isAnimationActive={false} />
            <Bar
              dataKey="sell_in_recommended"
              stackId="sell-in"
              fill="var(--color-sell_in_recommended)"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              dataKey="sell_out_actual"
              stroke="var(--color-sell_out_actual)"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="sell_out_forecast"
              stroke="var(--color-sell_out_forecast)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
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
