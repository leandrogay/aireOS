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
      { label: name, color: CUSTOMER_COLORS[index % CUSTOMER_COLORS.length] },
    ]),
  );

  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <BarChart accessibilityLayer data={rows} margin={{ bottom: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis tickFormatter={formatUnits} width={56} tick={{ fontSize: 10 }} />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value) => `${formatUnits(value)} units`} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
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
  );
}
