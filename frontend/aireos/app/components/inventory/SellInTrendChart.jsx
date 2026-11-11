'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { BAR_ANIMATION, chartDataRange, metricYAxisProps, yearAxisProps } from '@/app/utils/trendChart';
import useChartTransition from '@/hooks/useChartTransition';
import useMediaQuery from '@/hooks/useMediaQuery';

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
  const mobile = useMediaQuery('(max-width: 639px)');
  const rows = trend.map((row) => ({ ...row, label: formatMonth(row.month) }));
  // Fixed nice steps, so a filter change can move the bars and the axis together.
  const yAxisProps = metricYAxisProps('units', chartDataRange(rows, ['sell_in']));
  const transition = useChartTransition({
    rows,
    rowKey: 'month',
    valueKeys: ['sell_in'],
    domain: yAxisProps.domain,
    ticks: yAxisProps.ticks,
  });

  if (trend.length === 0) {
    return <p className="text-sm text-ink-soft">No inventory data for these filters.</p>;
  }

  return (
    <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
      <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
        <BarChart accessibilityLayer data={transition.rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--aire-lavender)" />
          <XAxis
            dataKey={mobile ? 'month' : 'label'}
            interval={0}
            height={mobile ? 28 : 52}
            tick={{ fontSize: 9, fill: 'var(--aire-deep-blue)' }}
            angle={mobile ? 0 : -40}
            textAnchor={mobile ? 'middle' : 'end'}
            tickMargin={6}
            {...(mobile ? yearAxisProps(rows, 'month') : {})}
          />
          <YAxis
            domain={transition.domain}
            ticks={transition.ticks}
            width={48}
            tick={{ fontSize: 10, fill: 'var(--aire-deep-blue)' }}
            tickFormatter={formatUnits}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="border-violet/40 bg-white"
                formatter={labelledTooltipRow(chartConfig, (value) => `${formatUnits(value)} units`)}
              />
            }
          />
          <Bar dataKey="sell_in" fill="var(--color-sell_in)" radius={[2, 2, 0, 0]} {...BAR_ANIMATION} {...transition.seriesAnimation} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
