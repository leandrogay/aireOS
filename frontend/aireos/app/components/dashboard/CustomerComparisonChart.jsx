'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { CHART_SIZE_CLASS, MAX_BAR_SIZE, formatAxisCurrency, formatRevenue } from '@/app/utils/trendChart';

function formatAxisUnits(value) {
  if (typeof value !== 'number') return value;
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  }
  return `${value}`;
}

function formatValue(metric, value) {
  if (metric === 'units') return Number(value).toLocaleString();
  return formatRevenue(value);
}

function ComparisonTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  return (
    <div className="grid min-w-32 items-start gap-1 rounded-lg border border-lavander bg-white px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium text-deep-violet-blue">{row.payload.label}</div>
      <div className="font-mono font-medium text-deep-violet-blue tabular-nums">
        {formatValue(metric, row.value)}
      </div>
    </div>
  );
}

/**
 * One bar per customer for the selected period. Customers without the active
 * channel (NHG has no online sales) are left off. Bars are largest first.
 *
 * @param {{ customers: Array<object>, mode: 'offline' | 'online', metric: 'revenue' | 'units' }} props
 */
export default function CustomerComparisonChart({ customers, mode, metric }) {
  const rows = customers
    .filter((customer) => (mode === 'online' ? customer.has_online : customer.has_offline))
    .map((customer) => ({
      label: customer.label,
      value: customer[mode]?.[metric] ?? 0,
    }))
    .sort((a, b) => b.value - a.value);
  const chartConfig = {
    value: {
      label: metric === 'units' ? 'Volume' : 'Revenue',
      color: 'var(--aire-deep-blue)',
    },
  };
  const axisProps = rows.length > 4
    ? { interval: 0, angle: -45, textAnchor: 'end', height: 56 }
    : { interval: 0 };
  const margin = axisProps.angle ? { bottom: 8, left: 24 } : { bottom: 8 };

  if (customers.length === 0) {
    return (
      <p className="flex flex-1 items-center text-sm text-deep-violet-blue/60">
        Select at least one customer.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="flex flex-1 items-center text-sm text-deep-violet-blue/60">
        No sales for the selected customers in this period.
      </p>
    );
  }

  return (
    <ChartContainer config={chartConfig} className={CHART_SIZE_CLASS}>
      <BarChart accessibilityLayer data={rows} margin={margin}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" {...axisProps} tick={{ fontSize: 11 }} />
        <YAxis
          tickFormatter={metric === 'units' ? formatAxisUnits : formatAxisCurrency}
          width={50}
          tick={{ fontSize: 10 }}
        />
        <ChartTooltip content={<ComparisonTooltip metric={metric} />} />
        <Bar dataKey="value" fill="var(--color-value)" maxBarSize={MAX_BAR_SIZE} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
