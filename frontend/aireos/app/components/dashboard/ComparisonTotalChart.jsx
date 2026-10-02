'use client';

import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { changePct } from '@/app/utils/periodComparison';
import {
  CHART_SIZE_CLASS,
  MAX_BAR_SIZE,
  bucketLabel,
  exactBucketLabel,
  formatAxisCurrency,
  xAxisProps,
} from '@/app/utils/trendChart';
import { HatchPattern, PeriodKeySwatch, patternId } from '@/components/dashboard/PeriodTexture';
import TooltipChange from '@/components/dashboard/TooltipChange';

// Labels are filled in per render with the two periods' names
// ("Aug 2026" / "Aug 2025"). Neutral period colours (globals.css), not
// format colours: in the Total view a deep blue bar would read as HYPER and
// a lavender one as UNITY. The comparison bar is hatched like the By format
// view's (see PeriodTexture), so "textured = past" holds across both views.
const comparisonChartConfig = {
  current: { label: 'This period', color: 'var(--chart-period-current)' },
  baseline: { label: 'Comparison', color: 'var(--chart-period-baseline)' },
};

// One line per side, each named by the exact dates of the hovered bar
// ("Aug 14 – Aug 20, 2026" against "Aug 15 – Aug 21, 2025") — the dates
// identify the sides, so no swatches repeating the legend. The whole
// periods' names are left to the legend.
function ComparisonTooltip({ active, payload, granularity }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const sides = [
    { key: 'current', label: row.currentLabel, value: row.current },
    { key: 'baseline', label: row.baselineLabel, value: row.baseline },
  ];

  return (
    <div className="grid min-w-44 gap-1 rounded-lg border border-lavander bg-white px-2.5 py-1.5 text-xs text-deep-violet-blue shadow-xl">
      {sides.map((side) => (
        <div key={side.key} className="flex items-center justify-between gap-3">
          <span className={side.key === 'current' ? 'font-medium' : 'text-deep-violet-blue/70'}>
            {side.label ?? 'No comparison data'}
          </span>
          <span className="font-mono font-medium tabular-nums">
            {side.value === null ? 'No data' : `$${side.value.toLocaleString()}`}
          </span>
        </div>
      ))}
      <TooltipChange
        pct={row.current !== null ? changePct(row.current, row.baseline) : null}
        suffix={`vs comparison ${granularity}`}
      />
    </div>
  );
}

/**
 * The comparison chart's "Total" view: per bucket, the comparison period's
 * total (hatched, left) beside this period's (solid, right), in the neutral
 * period colours. `rows` come pre-aligned from alignComparisonBuckets; the
 * x-axis labels this period's bucket (from axisStart, so it is dated even
 * where this period has no data).
 *
 * @param {{
 *   rows: Array<{ axisStart: string, current: object | null, baseline: object | null }>,
 *   periodNames: { current: string, baseline: string } | null,
 *   granularity: 'week' | 'month',
 * }} props
 */
export default function ComparisonTotalChart({ rows, periodNames, granularity }) {
  const hatchId = patternId(useId(), 'total');
  const chartConfig = {
    current: { ...comparisonChartConfig.current, label: periodNames?.current || comparisonChartConfig.current.label },
    baseline: { ...comparisonChartConfig.baseline, label: periodNames?.baseline || comparisonChartConfig.baseline.label },
  };
  const chartData = rows.map((row) => ({
    axisLabel: bucketLabel(granularity, row.axisStart),
    currentLabel: exactBucketLabel(granularity, row.axisStart),
    baselineLabel: row.baseline?.label ?? null,
    current: row.current?.revenue ?? null,
    baseline: row.baseline?.revenue ?? null,
  }));

  return (
    <>
      <ChartContainer config={chartConfig} className={CHART_SIZE_CLASS}>
        <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="axisLabel" {...xAxisProps(chartData.length, granularity)} />
          <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
          <ChartTooltip content={<ComparisonTooltip granularity={granularity} />} />
          <defs>
            <HatchPattern id={hatchId} tint="var(--chart-period-baseline)" stripe="var(--chart-period-current)" />
          </defs>
          <Bar
            dataKey="baseline"
            fill={`url(#${hatchId})`}
            stroke="var(--chart-period-current)"
            strokeWidth={1}
            maxBarSize={MAX_BAR_SIZE}
            isAnimationActive={false}
          />
          <Bar
            dataKey="current"
            fill="var(--color-current)"
            maxBarSize={MAX_BAR_SIZE}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      {/* Own legend (not ChartLegendContent) so the comparison swatch shows
          the hatch, not a flat cream square. Comparison first, matching the
          bars. */}
      <div className="flex items-center justify-center gap-4 pt-2 text-xs text-deep-violet-blue">
        {['baseline', 'current'].map((side) => (
          <span key={side} className="flex items-center gap-1.5">
            <PeriodKeySwatch hatched={side === 'baseline'} />
            {chartConfig[side].label}
          </span>
        ))}
      </div>
    </>
  );
}
