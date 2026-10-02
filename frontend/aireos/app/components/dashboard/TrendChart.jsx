'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from '@/components/ui/chart';
import { changePct } from '@/app/utils/periodComparison';
import { formatColor } from '@/app/utils/storeFormats';
import {
  CHART_SIZE_CLASS,
  MAX_BAR_SIZE,
  displayLabelFor,
  exactBucketLabel,
  formatAxisCurrency,
  sortFormatsByTotalDesc,
  xAxisProps,
} from '@/app/utils/trendChart';
import TooltipChange from '@/components/dashboard/TooltipChange';

// The revenue trend with no comparison: TotalTrendChart (neutral bars) and
// FormatTrendChart (stacked by store format), the Total / By format pair of
// RevenueTrendCard's switch.

// "Total" view: the neutral period colour, never a format colour, so a
// single bar is never read as one format — unless the channel has only one
// format (online's FPON), which passes its colour in (see singleFormatColor).
function totalChartConfig(color) {
  return { revenue: { label: 'Revenue', color: color ?? 'var(--chart-period-current)' } };
}

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
 * "Total" view with no comparison: one neutral bar per week/month. Also the
 * only view for a single-format channel (online), drawn in that format's
 * `color` when given.
 *
 * @param {{ periodTotal: Array<object>, granularity: 'week' | 'month', color?: string | null }} props
 */
export function TotalTrendChart({ periodTotal, granularity, color = null }) {
  // exactLabel uses the ROW's own actual type (weekOrMonth), not the
  // requested `granularity` — a month-preferred row can appear even under
  // granularity='month' requests mixed with no real weekly rows elsewhere,
  // and mislabeling it a week in the tooltip (e.g. "Aug 1 – Aug 7, 2026"
  // for a row that's really all of August) would contradict the bar's own
  // displayLabel right next to it. Matches FormatTrendChart's pivotByFormat.
  const chartData = periodTotal.map((row, index) => ({
    displayLabel: displayLabelFor(row.period_label, row.period_start),
    exactLabel: exactBucketLabel(weekOrMonth(row.period_label), row.period_start),
    revenue: row.revenue,
    changePct: index > 0 ? changePct(row.revenue, periodTotal[index - 1].revenue) : null,
  }));

  return (
    <ChartContainer config={totalChartConfig(color)} className={CHART_SIZE_CLASS}>
      <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="displayLabel" {...xAxisProps(chartData.length, granularity)} />
        <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
        <ChartTooltip content={<TrendTooltip granularity={granularity} />} />
        <Bar
          dataKey="revenue"
          name="Revenue"
          fill="var(--color-revenue)"
          maxBarSize={MAX_BAR_SIZE}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * "By format" view with no comparison: one bar per week/month stacked by
 * store format, in the format colours.
 *
 * @param {{ periodByFormat: Array<object>, periodTotal: Array<object>, granularity: 'week' | 'month' }} props
 */
export function FormatTrendChart({ periodByFormat, periodTotal, granularity }) {
  const formats = sortFormatsByTotalDesc(periodByFormat);
  const chartConfig = Object.fromEntries(formats.map((format) => [format, { label: format, color: formatColor(format) }]));
  const chartData = pivotByFormat(periodByFormat, periodTotal);

  return (
    <ChartContainer config={chartConfig} className={CHART_SIZE_CLASS}>
      <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="displayLabel" {...xAxisProps(chartData.length, granularity)} />
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
