'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';

import { labelledTooltipRow } from './chartTooltip';

const chartConfig = {
  forecast_sell_out: { label: 'Forecast sell-out', color: 'var(--aire-violet)' },
  recommended_sell_in: { label: 'Recommended sell-in', color: 'var(--aire-deep-blue)' },
};

// Caps how wide a bar can get when only a few months are planned.
const MAX_BAR_SIZE = 40;

/**
 * Per month: what the forecast says will sell out against the sell-in needed
 * to hold the target DOH (backend get_sell_in_plan `monthly_totals`, all SKUs).
 *
 * @param {{ totals: Array<{ month: string, forecast_sell_out: number, recommended_sell_in: number }> }} props
 */
export default function SellInPlanChart({ totals }) {
  if (totals.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No forecast is available to plan from.</p>;
  }

  const rows = totals.map((row) => ({ ...row, label: formatMonth(row.month) }));

  return (
    <ChartContainer config={chartConfig} className="h-[260px] w-full">
      <BarChart accessibilityLayer data={rows} margin={{ bottom: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis tickFormatter={formatUnits} width={56} tick={{ fontSize: 10 }} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={labelledTooltipRow(chartConfig, (value) => `${formatUnits(value)} units`)}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="forecast_sell_out"
          fill="var(--color-forecast_sell_out)"
          radius={[4, 4, 0, 0]}
          maxBarSize={MAX_BAR_SIZE}
          isAnimationActive={false}
        />
        <Bar
          dataKey="recommended_sell_in"
          fill="var(--color-recommended_sell_in)"
          radius={[4, 4, 0, 0]}
          maxBarSize={MAX_BAR_SIZE}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
