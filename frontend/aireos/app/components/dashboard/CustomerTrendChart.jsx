'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from '@/components/ui/chart';
import ChartFrame, { CHART_TOOLTIP_CLASS } from '@/components/ui/ChartFrame';
import { ESTIMATE_PILL_CLASS } from '@/components/dashboard/EstMark';
import { hasEstimate } from '@/app/utils/estimatedRevenue';
import { cn } from '@/lib/utils';
import { trendRows, trendSeries } from '@/app/utils/customerTrend';
import { trendChartKind } from '@/app/utils/chartKind';
import {
  BAR_ANIMATION,
  CHART_SIZE_CLASS,
  MAX_BAR_SIZE,
  MAX_DOTTED_POINTS,
  TILTED_LABEL_LEFT_MARGIN,
  formatMetric,
  chartDataRange,
  metricYAxisProps,
  CHART_TOP_MARGIN,
  periodAxisProps,
  weekMonthGroups,
  yearAxisProps,
} from '@/app/utils/trendChart';
import MonthAxis from '@/components/dashboard/MonthAxis';
import useChartTransition from '@/hooks/useChartTransition';
import useMediaQuery from '@/hooks/useMediaQuery';


function formatValue(metric, value) {
  // No sales loaded for that customer and period.
  if (value === null || value === undefined) return '—';
  return formatMetric(metric, value);
}

// The hovered period: every customer's figure in its colour, an est. tag after
// the name of any whose revenue is partly estimated, and the customers'
// total. Two columns, so names and figures each line up with one fixed gap
// between them, whichever names carry the tag.
function TrendTooltip({ active, payload, metric, series }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const total = series.reduce((sum, item) => sum + (row[item.key] ?? 0), 0);

  return (
    // ChartTooltipContent's box in the shared tooltip look; the rows are this chart's own.
    <div
      className={cn(
        'grid min-w-40 grid-cols-[auto_auto] items-center gap-x-6 gap-y-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl',
        CHART_TOOLTIP_CLASS,
      )}
    >
      <div className="col-span-2 font-medium text-deep-violet-blue">{row.exactLabel}</div>
      {series.map((item) => (
        <div key={item.key} className="col-span-2 grid grid-cols-subgrid">
          <span className="flex items-center gap-1.5 text-deep-violet-blue/70">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
            {item.label}
            {hasEstimate(row[`${item.key}Estimated`]) && (
              <span className={cn(ESTIMATE_PILL_CLASS, 'h-4 px-1 text-[10px]')}>est.</span>
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
 * summary tiles and ranking use. While customers x periods is within the
 * screen's bar limit (chartKind: 12 on desktop, 3 on a phone) it is grouped
 * bars, one per customer in each period; past that each customer is a line,
 * since the bars would be too thin to read. Customers
 * without the active channel (NHG has no online sales) are left off.
 *
 * @param {{ customers: Array<object>, mode: 'offline' | 'online', metric: 'revenue' | 'units', granularity: 'week' | 'month', palette: { byName: Map<string, string> } }} props
 */
export default function CustomerTrendChart({ customers, mode, metric, granularity, palette }) {
  const mobile = useMediaQuery('(max-width: 639px)');
  const series = trendSeries(customers, mode, palette);
  const rows = trendRows(customers, series, mode, metric, granularity);
  const kind = trendChartKind({ customerCount: series.length, periodCount: rows.length, mobile });
  const chartConfig = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }]));
  const axisProps = mobile ? yearAxisProps(rows, 'periodStart') : periodAxisProps(rows, granularity);
  // On a phone the axis is labelled by year (yearAxisProps), so no month axis.
  const monthGroups = mobile ? null : weekMonthGroups(rows, granularity);
  // Bars sit in the middle of their slot; a line's first and last points sit
  // on the plot's edges, so the line chart pads its x-axis and keeps room on
  // the right for its last point and label.
  const margin = {
    top: CHART_TOP_MARGIN,
    bottom: 8,
    ...(axisProps.angle ? { left: TILTED_LABEL_LEFT_MARGIN } : {}),
    ...(kind === 'lines' ? { right: 16 } : {}),
  };
  // Customers sit side by side (bars) or as separate lines, never stacked,
  // so the axis reaches the single tallest customer's value.
  const seriesKeys = series.map((item) => item.key);
  const yAxisProps = metricYAxisProps(metric, chartDataRange(rows, seriesKeys, { stacked: false }));
  // A change (Revenue / Volume, customers) moves the bars or lines and the axis together.
  const transition = useChartTransition({
    rows,
    rowKey: 'periodStart',
    valueKeys: seriesKeys,
    domain: yAxisProps.domain,
    ticks: yAxisProps.ticks,
  });
  const yAxis = <YAxis {...yAxisProps} domain={transition.domain} ticks={transition.ticks} />;
  // Above the legend, which is drawn after it and would show through.
  const tooltip = (
    <ChartTooltip content={<TrendTooltip metric={metric} series={series} />} wrapperStyle={{ zIndex: 10 }} />
  );

  if (customers.length === 0) {
    return (
      <p className="flex flex-1 items-center justify-center text-center text-sm text-deep-violet-blue/60">
        Select at least one customer.
      </p>
    );
  }

  if (series.length === 0 || rows.length === 0) {
    return (
      <p className="flex flex-1 items-center justify-center text-center text-sm text-deep-violet-blue/60">
        No sales for the selected customers in this period.
      </p>
    );
  }

  return (
    <ChartFrame fill>
      <ChartContainer config={chartConfig} className={CHART_SIZE_CLASS}>
        {kind === 'bars' ? (
          <BarChart accessibilityLayer data={transition.rows} margin={margin}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey={mobile ? 'periodStart' : 'displayLabel'} {...axisProps} />
            {yAxis}
            <MonthAxis groups={monthGroups} />
            {tooltip}
            <ChartLegend content={<ChartLegendContent />} />
            {series.map((item) => (
              <Bar key={item.key} dataKey={item.key} fill={`var(--color-${item.key})`} radius={[10, 10, 0, 0]} maxBarSize={MAX_BAR_SIZE} {...BAR_ANIMATION} {...transition.seriesAnimation} />
            ))}
          </BarChart>
        ) : (
          <LineChart accessibilityLayer data={transition.rows} margin={margin}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey={mobile ? 'periodStart' : 'displayLabel'} {...axisProps} padding={{ left: 24, right: 24 }} />
            {yAxis}
            <MonthAxis groups={monthGroups} />
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
                {...transition.seriesAnimation}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
    </ChartFrame>
  );
}
