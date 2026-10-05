'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from '@/components/ui/chart';
import { changePct } from '@/app/utils/periodComparison';
import { formatColor } from '@/app/utils/storeFormats';
import {
  CHART_SIZE_CLASS,
  MAX_BAR_SIZE,
  TILTED_LABEL_LEFT_MARGIN,
  displayLabelFor,
  exactBucketLabel,
  formatAxisCurrency,
  sortFormatsByTotalDesc,
  xAxisProps,
} from '@/app/utils/trendChart';
import TooltipChange from '@/components/dashboard/TooltipChange';

// The revenue trend with no comparison (FormatTrendChart), stacked by store
// format; RevenueTrendCard uses ComparisonMixChart while comparing.

function weekOrMonth(periodLabel) {
  return periodLabel.startsWith('Week ') ? 'week' : 'month';
}

// Reshapes the flat [{ period_label, period_start, format, revenue }] rows
// the API returns into one row per period with a column per format, which
// is the shape Recharts needs for a stacked bar, plus each period's % change
// vs the one before it (from `periodTotal`) for the tooltip.
function pivotByFormat(periodByFormat, periodTotal) {
  const byPeriod = new Map();
  for (const row of periodByFormat) {
    if (!byPeriod.has(row.period_label)) {
      byPeriod.set(row.period_label, {
        period_label: row.period_label,
        displayLabel: displayLabelFor(row.period_label, row.period_start),
        exactLabel: exactBucketLabel(weekOrMonth(row.period_label), row.period_start),
      });
    }
    byPeriod.get(row.period_label)[row.format] = row.revenue;
  }
  periodTotal.forEach((row, index) => {
    const period = byPeriod.get(row.period_label);
    if (period && index > 0) period.changePct = changePct(row.revenue, periodTotal[index - 1].revenue);
  });
  return [...byPeriod.values()];
}

// Titled with the hovered bar's exact dates, one row per series — with a
// colour square only when the series are formats, where the colour means
// something — a Total row when stacked, and the % change vs the previous bar.
function TrendTooltip({ active, payload, granularity }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, item) => sum + (typeof item.value === 'number' ? item.value : 0), 0);
  const stacked = payload.length > 1;

  return (
    <div className="grid min-w-32 items-start gap-1.5 rounded-lg border border-lavander bg-white px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium text-deep-violet-blue">{payload[0].payload.exactLabel}</div>
      <div className="grid gap-1.5">
        {payload.map((item) => (
          <div key={item.dataKey} className="flex w-full items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-deep-violet-blue/70">
              {stacked && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color ?? item.payload?.fill }}
                />
              )}
              {item.name}
            </span>
            <span className="font-mono font-medium text-deep-violet-blue tabular-nums">
              ${Number(item.value).toLocaleString()}
            </span>
          </div>
        ))}
        {stacked && (
          <div className="mt-0.5 flex w-full items-center justify-between gap-2 border-t border-lavander pt-1">
            <span className="font-medium text-deep-violet-blue">Total</span>
            <span className="font-mono font-semibold text-deep-violet-blue tabular-nums">
              ${total.toLocaleString()}
            </span>
          </div>
        )}
        <TooltipChange pct={payload[0].payload.changePct} suffix={`vs previous ${granularity}`} />
      </div>
    </div>
  );
}

/**
 * The trend with no comparison: one bar per week/month stacked by store
 * format, in the format colours (a single-format channel is one colour).
 * Each bar is labelled by its row's own type (weekOrMonth), so a
 * month-only row is never titled as a week in the tooltip.
 *
 * @param {{ periodByFormat: Array<object>, periodTotal: Array<object>, granularity: 'week' | 'month' }} props
 */
export function FormatTrendChart({ periodByFormat, periodTotal, granularity }) {
  const formats = sortFormatsByTotalDesc(periodByFormat);
  const chartConfig = Object.fromEntries(formats.map((format) => [format, { label: format, color: formatColor(format) }]));
  const chartData = pivotByFormat(periodByFormat, periodTotal);
  const axisProps = xAxisProps(chartData.length, granularity);
  // Tilted labels run down-left from their bar, so the first needs room past the y-axis.
  const margin = axisProps.angle ? { bottom: 8, left: TILTED_LABEL_LEFT_MARGIN } : { bottom: 8 };

  return (
    <ChartContainer config={chartConfig} className={CHART_SIZE_CLASS}>
      <BarChart accessibilityLayer data={chartData} margin={margin}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="displayLabel" {...axisProps} />
        <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
        <ChartTooltip content={<TrendTooltip granularity={granularity} />} />
        <ChartLegend content={<ChartLegendContent />} />
        {formats.map((format) => (
          <Bar
            key={format}
            dataKey={format}
            stackId="format"
            fill={`var(--color-${format})`}
            maxBarSize={MAX_BAR_SIZE}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
