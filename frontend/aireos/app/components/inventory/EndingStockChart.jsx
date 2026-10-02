'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { retailerLabel } from '@/app/utils/retailerLabel';

import { labelledTooltipRow } from './chartTooltip';

// AIRE palette, one colour per customer in the order they appear.
const CUSTOMER_COLORS = [
  'var(--aire-deep-blue)',
  'var(--aire-violet)',
  'var(--aire-celest)',
  'var(--aire-lavender)',
];

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
 *
 * @param {{ monthly: Array<{ customer_id: number, customer_name: string, month: string, ending_stock: number }> }} props
 */
export default function EndingStockChart({ monthly }) {
  const { rows, customers } = pivotByCustomer(monthly);

  if (rows.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No inventory data for these filters.</p>;
  }

  const config = Object.fromEntries(
    customers.map(([id, name], index) => [
      `c${id}`,
      { label: retailerLabel(name), color: CUSTOMER_COLORS[index % CUSTOMER_COLORS.length] },
    ]),
  );

  return (
    <div className="space-y-2">
      <div className="overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
        <ChartContainer config={config} className="aspect-auto h-[280px] w-full">
          <BarChart
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
            <YAxis
              tickFormatter={formatUnits}
              width={48}
              tick={{ fontSize: 10, fill: '#3A4369' }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="border-violet/40 bg-white"
                  formatter={labelledTooltipRow(config, (value) => `${formatUnits(value)} units`)}
                />
              }
            />
            {customers.map(([id]) => (
              <Bar
                key={id}
                dataKey={`c${id}`}
                fill={`var(--color-c${id})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={MAX_BAR_SIZE}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-deep-violet-blue">
        {customers.map(([id, name], index) => (
          <span key={id} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: CUSTOMER_COLORS[index % CUSTOMER_COLORS.length] }}
            />
            {retailerLabel(name)}
          </span>
        ))}
      </div>
    </div>
  );
}
