'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

import { formatDoh, formatMonth } from '@/app/utils/inventoryForm';

const chartConfig = {
  doh: { label: 'DOH', color: 'var(--aire-deep-blue)' },
  target_doh: { label: 'Target', color: 'var(--aire-violet)' },
  min_doh: { label: 'Min', color: 'var(--aire-celest)' },
  max_doh: { label: 'Max', color: 'var(--aire-celest)' },
};

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
    <ChartContainer config={chartConfig} className="h-[260px] w-full">
      <LineChart accessibilityLayer data={rows} margin={{ bottom: 8, left: 4, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis width={40} tick={{ fontSize: 10 }} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => `${formatDoh(value)} days`} />} />
        <ChartLegend content={<ChartLegendContent />} />
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
  );
}
