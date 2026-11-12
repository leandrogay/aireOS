'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import ChartFrame, { CHART_TOOLTIP_CLASS } from '@/components/ui/ChartFrame';

import { NO_CUSTOMER_COLOR } from '@/app/utils/customerColors';
import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { AXIS_TICK, BAR_ANIMATION, MAX_BAR_SIZE, chartDataRange, metricYAxisProps, yearAxisProps } from '@/app/utils/trendChart';
import useChartTransition from '@/hooks/useChartTransition';
import useMediaQuery from '@/hooks/useMediaQuery';

import { labelledTooltipRow } from './chartTooltip';

/**
 * Sell-in per month for one customer (backend get_customer_view `trend`), in
 * that customer's colour (utils/customerColors).
 *
 * @param {{ trend: Array<{ month: string, sell_in: number }>, color?: string }} props
 */
export default function SellInTrendChart({ trend, color = NO_CUSTOMER_COLOR }) {
  const chartConfig = { sell_in: { label: 'Sell-in', color } };
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
    return <p className="text-sm text-deep-violet-blue/70">No inventory data for these filters.</p>;
  }

  return (
    // In the same frame as its skeleton (CustomerInventoryView), so nothing moves when it arrives.
    <ChartFrame>
      <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
        <BarChart accessibilityLayer data={transition.rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={mobile ? 'month' : 'label'}
            interval={0}
            height={mobile ? 28 : 52}
            tick={AXIS_TICK}
            angle={mobile ? 0 : -40}
            textAnchor={mobile ? 'middle' : 'end'}
            tickMargin={6}
            {...(mobile ? yearAxisProps(rows, 'month') : {})}
          />
          <YAxis
            domain={transition.domain}
            ticks={transition.ticks}
            width={48}
            tick={AXIS_TICK}
            tickFormatter={formatUnits}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className={CHART_TOOLTIP_CLASS}
                formatter={labelledTooltipRow(chartConfig, (value) => `${formatUnits(value)} units`)}
              />
            }
          />
          <Bar dataKey="sell_in" fill="var(--color-sell_in)" radius={[10, 10, 0, 0]} maxBarSize={MAX_BAR_SIZE} {...BAR_ANIMATION} {...transition.seriesAnimation} />
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
