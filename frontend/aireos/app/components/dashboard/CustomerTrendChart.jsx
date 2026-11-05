'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from '@/components/ui/chart';
import { hasEstimate } from '@/app/utils/estimatedRevenue';
import { trendChartKind, trendRows, trendSeries } from '@/app/utils/customerTrend';
import {
  BAR_ANIMATION,
  CHART_SIZE_CLASS,
  MAX_BAR_SIZE,
  TILTED_LABEL_LEFT_MARGIN,
  formatMetric,
  metricAxisFormatter,
  periodAxisProps,
} from '@/app/utils/trendChart';

// Past this many points a dot on every one crowds the line; the hovered
// point still gets one (activeDot).
const MAX_DOTTED_POINTS = 26;

function formatValue(metric, value) {
  // No sales loaded for that customer and period.
  if (value === null || value === undefined) return '—';
  return formatMetric(metric, value);
}

// The hovered period: every customer's figure in its colour, "(EST)" after
// the name of any whose revenue is partly estimated, and the customers'
// total. Two columns, so names and figures each line up with one fixed gap
// between them, whichever names carry (EST).
function TrendTooltip({ active, payload, metric, series }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const total = series.reduce((sum, item) => sum + (row[item.key] ?? 0), 0);

  return (
    <div className="grid min-w-40 grid-cols-[auto_auto] items-center gap-x-6 gap-y-1.5 rounded-lg border border-lavander bg-white px-2.5 py-1.5 text-xs shadow-xl">
      <div className="col-span-2 font-medium text-deep-violet-blue">{row.exactLabel}</div>
      {series.map((item) => (
        <div key={item.key} className="col-span-2 grid grid-cols-subgrid">
          <span className="flex items-center gap-1.5 text-deep-violet-blue/70">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
            {item.label}
            {hasEstimate(row[`${item.key}Estimated`]) && (
              <span className="text-[10px] font-semibold tracking-wider text-violet">(EST)</span>
            )}
          </span>
          <span className="text-right font-mono font-medium text-deep-violet-blue tabular-nums">
            {formatValue(metric, row[item.key])}
          </span>
        </div>
      ))}
      {series.length > 1 && (
        <div className="col-span-2 mt-0.5 grid grid-cols-subgrid border-t border-lavander pt-1">
          <span className="font-medium text-deep-violet-blue">Total</span>
          <span className="text-right font-mono font-semibold text-deep-violet-blue tabular-nums">
            {formatValue(metric, total)}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Each ticked customer per week or month, in the customer colours the
 * summary tiles and ranking use. Up to MAX_BAR_PERIODS periods it is grouped
 * bars (one per customer in each period); past that each customer is a line,
 * since 3 customers x 12 months would be 36 bars too thin to read. Customers
 * without the active channel (NHG has no online sales) are left off.
 *
 * @param {{ customers: Array<object>, mode: 'offline' | 'online', metric: 'revenue' | 'units', granularity: 'week' | 'month' }} props
 */
export default function CustomerTrendChart({ customers, mode, metric, granularity }) {
  const series = trendSeries(customers, mode);
  const rows = trendRows(customers, series, mode, metric, granularity);
  const kind = trendChartKind(rows.length);
  const chartConfig = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }]));
  const axisProps = periodAxisProps(rows, granularity);
  // Bars sit in the middle of their slot; a line's first and last points sit
  // on the plot's edges, so the line chart pads its x-axis and keeps room on
  // the right for its last point and label.
  const margin = {
    bottom: 8,
    ...(axisProps.angle ? { left: TILTED_LABEL_LEFT_MARGIN } : {}),
    ...(kind === 'lines' ? { right: 16 } : {}),
  };
  const yAxis = (
    <YAxis
      tickFormatter={metricAxisFormatter(metric)}
      width={50}
      tick={{ fontSize: 10 }}
    />
  );
  // Above the legend, which is drawn after it and would show through.
  const tooltip = (
    <ChartTooltip content={<TrendTooltip metric={metric} series={series} />} wrapperStyle={{ zIndex: 10 }} />
  );

  if (customers.length === 0) {
    return (
      <p className="flex flex-1 items-center text-sm text-deep-violet-blue/60">
        Select at least one customer.
      </p>
    );
  }

  if (series.length === 0 || rows.length === 0) {
    return (
      <p className="flex flex-1 items-center text-sm text-deep-violet-blue/60">
        No sales for the selected customers in this period.
      </p>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <ChartContainer config={chartConfig} className={CHART_SIZE_CLASS}>
        {kind === 'bars' ? (
          <BarChart accessibilityLayer data={rows} margin={margin}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="displayLabel" {...axisProps} />
            {yAxis}
            {tooltip}
            <ChartLegend content={<ChartLegendContent />} />
            {series.map((item) => (
              <Bar key={item.key} dataKey={item.key} fill={`var(--color-${item.key})`} maxBarSize={MAX_BAR_SIZE} {...BAR_ANIMATION} />
            ))}
          </BarChart>
        ) : (
          <LineChart accessibilityLayer data={rows} margin={margin}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="displayLabel" {...axisProps} padding={{ left: 24, right: 24 }} />
            {yAxis}
            {tooltip}
            <ChartLegend content={<ChartLegendContent />} />
            {series.map((item) => (
              <Line
                key={item.key}
                dataKey={item.key}
                type="linear"
                stroke={`var(--color-${item.key})`}
                strokeWidth={2}
                dot={rows.length > MAX_DOTTED_POINTS ? false : { r: 2.5 }}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
    </div>
  );
}
