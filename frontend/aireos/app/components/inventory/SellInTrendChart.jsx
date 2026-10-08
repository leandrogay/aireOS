'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';

import { labelledTooltipRow } from './chartTooltip';

const chartConfig = {
  sell_in: { label: 'Sell-in', color: 'var(--aire-deep-blue)' },
};

/**
 * Sell-in per month for one customer (backend get_customer_view `trend`).
 *
 * @param {{ trend: Array<{ month: string, sell_in: number }> }} props
 */
export default function SellInTrendChart({ trend }) {
  if (trend.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No inventory data for these filters.</p>;
  }

  const rows = trend.map((row) => ({ ...row, label: formatMonth(row.month) }));

  return (
    <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
      <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
        <BarChart accessibilityLayer data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
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
            content={
              <ChartTooltipContent
                className="border-violet/40 bg-white"
                formatter={labelledTooltipRow(chartConfig, (value) => `${formatUnits(value)} units`)}
              />
            }
          />
          <Bar dataKey="sell_in" fill="var(--color-sell_in)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
