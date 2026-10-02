'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

import { formatDoh, formatMonth } from '@/app/utils/inventoryForm';

import { labelledTooltipRow } from './chartTooltip';

const SERIES = [
  { key: 'doh', label: 'DOH', color: 'var(--aire-deep-blue)' },
  { key: 'target_doh', label: 'Target', color: 'var(--aire-violet)' },
  { key: 'min_doh', label: 'Min', color: 'var(--aire-celest)' },
  { key: 'max_doh', label: 'Max', color: 'var(--aire-celest)' },
];

const chartConfig = Object.fromEntries(
  SERIES.map((series) => [series.key, { label: series.label, color: series.color }]),
);

// Tooltip order: the measured DOH first, then the target and its band.
const TOOLTIP_ORDER = ['doh', 'target_doh', 'max_doh', 'min_doh'];

/**
 * Days of holding per month for one customer, against that month's target and
 * min/max band (backend get_customer_view `trend`). A month whose DOH could
 * not be measured leaves a gap in the line rather than a zero.
 *
 * @param {{ trend: Array<{ month: string, doh: number | null, target_doh: number, min_doh: number, max_doh: number }> }} props
 */
export default function DohTrendChart({ trend }) {
  if (trend.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No inventory data for these filters.</p>;
  }

  const rows = trend.map((row) => ({ ...row, label: formatMonth(row.month) }));

  return (
    <div className="space-y-2">
      <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
          <LineChart
            accessibilityLayer
            data={rows}
            margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
          >
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
            <YAxis width={40} tick={{ fontSize: 10, fill: '#3A4369' }} />
            <ChartTooltip
              itemSorter={(item) => TOOLTIP_ORDER.indexOf(item.dataKey)}
              content={
                <ChartTooltipContent
                  className="border-violet/40 bg-white"
                  formatter={labelledTooltipRow(chartConfig, (value) => `${formatDoh(value)} days`)}
                />
              }
            />
            <Line dataKey="max_doh" stroke="var(--color-max_doh)" strokeDasharray="2 4" dot={false} isAnimationActive={false} />
            <Line dataKey="min_doh" stroke="var(--color-min_doh)" strokeDasharray="2 4" dot={false} isAnimationActive={false} />
            <Line dataKey="target_doh" stroke="var(--color-target_doh)" strokeDasharray="6 4" dot={false} isAnimationActive={false} />
            <Line
              dataKey="doh"
              stroke="var(--color-doh)"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-deep-violet-blue">
        {SERIES.map((series) => (
          <span key={series.key} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: series.color }}
            />
            {series.label}
          </span>
        ))}
      </div>
    </div>
  );
}
