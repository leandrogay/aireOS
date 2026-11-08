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
import { retailerLabel } from '@/app/utils/retailerLabel';
import { customerColor, customerColorOrder } from '@/app/utils/storeFormats';
import { BAR_ANIMATION, chartDataRange, metricYAxisProps, yearAxisProps } from '@/app/utils/trendChart';
import useChartTransition from '@/hooks/useChartTransition';
import useMediaQuery from '@/hooks/useMediaQuery';

import { labelledTooltipRow } from './chartTooltip';

// Caps how wide a bar can get when only a few months are on screen.
const MAX_BAR_SIZE = 40;

/**
 * Turns the API rows [{ customer_id, customer_name, month, ending_stock }]
 * into one row per month with a column per customer, which is the shape
 * Recharts needs for grouped bars. Pure reshape: no sums or estimates.
 *
 * @param {Array<{ customer_id: number, customer_name: string, month: string, ending_stock: number }>} monthly
 */
function pivotByCustomer(monthly) {
  const byMonth = new Map();
  const customers = new Map();

  for (const row of monthly) {
    customers.set(row.customer_id, row.customer_name);
    if (!byMonth.has(row.month)) {
      byMonth.set(row.month, { month: row.month, label: formatMonth(row.month) });
    }
    byMonth.get(row.month)[`c${row.customer_id}`] = row.ending_stock;
  }

  return { rows: [...byMonth.values()], customers: [...customers.entries()] };
}

/**
 * Ending stock per month, one bar per customer (backend get_overview `monthly`).
 * Colours come from `allCustomers` (get_overview `customers`), not just the ones
 * charted, so a filter that hides a customer doesn't recolour the others.
 *
 * @param {{ monthly: Array<{ customer_id: number, customer_name: string, month: string, ending_stock: number }>, allCustomers: Array<{ customer_id: number, customer_name: string }> }} props
 */
export default function EndingStockChart({ monthly, allCustomers }) {
  const mobile = useMediaQuery('(max-width: 639px)');
  const { rows, customers } = pivotByCustomer(monthly);
  const barKeys = customers.map(([id]) => `c${id}`);
  // Fixed nice steps (below 0 too: ending stock can go negative), so a filter
  // change can move the bars and the axis together.
  const yAxisProps = metricYAxisProps('units', chartDataRange(rows, barKeys, { stacked: false }));
  const transition = useChartTransition({
    rows,
    rowKey: 'month',
    valueKeys: barKeys,
    domain: yAxisProps.domain,
    ticks: yAxisProps.ticks,
  });

  if (rows.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No inventory data for these filters.</p>;
  }

  const colorOrder = customerColorOrder(allCustomers);
  const config = Object.fromEntries(
    customers.map(([id, name]) => [
      `c${id}`,
      { label: retailerLabel(name), color: customerColor(name, colorOrder) },
    ]),
  );

  return (
    <div className="space-y-2">
      <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
        <ChartContainer config={config} className="aspect-auto h-[308px] w-full">
          <BarChart
            accessibilityLayer
            data={transition.rows}
            margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
          >
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
            <YAxis
              domain={transition.domain}
              ticks={transition.ticks}
              tickFormatter={formatUnits}
              width={48}
              tick={{ fontSize: 10, fill: '#3A4369' }}
            />
            {/* Above the legend, which is drawn after it and would show through. */}
            <ChartTooltip
              wrapperStyle={{ zIndex: 10 }}
              content={
                <ChartTooltipContent
                  className="border-violet/40 bg-white"
                  formatter={labelledTooltipRow(config, (value) => `${formatUnits(value)} units`)}
                />
              }
            />
            {/* Customers keep their order; the default sort would put c10 before c2. */}
            <ChartLegend itemSorter={null} content={<ChartLegendContent className="flex-wrap text-foreground" />} />
            {customers.map(([id]) => (
              <Bar
                key={id}
                dataKey={`c${id}`}
                fill={`var(--color-c${id})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={MAX_BAR_SIZE}
                {...BAR_ANIMATION}
                {...transition.seriesAnimation}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </div>
    </div>
  );
}
