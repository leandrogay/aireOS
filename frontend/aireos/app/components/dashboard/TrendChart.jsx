'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from '@/components/ui/chart';
import ChartFrame, { CHART_TOOLTIP_CLASS } from '@/components/ui/ChartFrame';
import { cn } from '@/lib/utils';
import { hasEstimate } from '@/app/utils/estimatedRevenue';
import { trendChartKind } from '@/app/utils/chartKind';
import { changePct } from '@/app/utils/periodComparison';
import { formatColor, UNNAMED_FORMAT } from '@/app/utils/storeFormats';
import {
  CHART_SIZE_CLASS,
  BAR_ANIMATION,
  MAX_BAR_SIZE,
  MAX_DOTTED_POINTS,
  TILTED_LABEL_LEFT_MARGIN,
  displayLabelFor,
  exactBucketLabel,
  formatMetric,
  formatRevenue,
  chartDataRange,
  metricYAxisProps,
  CHART_TOP_MARGIN,
  periodAxisProps,
  yearAxisProps,
  sortFormatsByTotalDesc,
  weekMonthGroups,
} from '@/app/utils/trendChart';
import MonthAxis from '@/components/dashboard/MonthAxis';
import useChartTransition from '@/hooks/useChartTransition';
import useMediaQuery from '@/hooks/useMediaQuery';
import TooltipChange from '@/components/dashboard/TooltipChange';

// The trend with no comparison (FormatTrendChart), revenue or units (the
// card's Revenue / Volume switch) stacked by store format; RevenueTrendCard
// uses ComparisonMixChart while comparing.

// The total line past the bar limit: its data key, and the colour the
// comparison chart's total line uses (ComparisonLineChart).
const TOTAL_KEY = 'total';
const TOTAL_LINE_COLOR = 'var(--aire-deep-blue)';

function weekOrMonth(periodLabel) {
  return periodLabel.startsWith('Week ') ? 'week' : 'month';
}

// Reshapes the flat [{ period_label, period_start, format, revenue, units }]
// rows the API returns into one row per period with a column per format
// holding `metric`, which is the shape Recharts needs for a stacked bar, plus
// the period's `total` (from `periodTotal`, the line past the bar limit), its
// % change vs the one before it for the tooltip, and how much of its revenue
// is estimated (`estimated`, said in the tooltip as an est. row).
function pivotByFormat(periodByFormat, periodTotal, metric) {
  const byPeriod = new Map();
  for (const row of periodByFormat) {
    if (!byPeriod.has(row.period_label)) {
      byPeriod.set(row.period_label, {
        period_label: row.period_label,
        periodStart: row.period_start,
        displayLabel: displayLabelFor(row.period_label, row.period_start),
        exactLabel: exactBucketLabel(weekOrMonth(row.period_label), row.period_start),
      });
    }
    byPeriod.get(row.period_label)[row.format] = row[metric];
  }
  periodTotal.forEach((row, index) => {
    const period = byPeriod.get(row.period_label);
    if (!period) return;
    period.total = row[metric];
    if (index > 0) period.changePct = changePct(row[metric], periodTotal[index - 1][metric]);
    period.estimated = row.estimated_revenue ?? 0;
  });
  return [...byPeriod.values()];
}

// The total line draws one series, but its tooltip still breaks the period
// down by format, like a stacked bar's: one row per format that sold.
function formatRows(period, formats) {
  return formats
    .filter((format) => typeof period[format] === 'number')
    .map((format) => ({ dataKey: format, name: format, value: period[format], color: formatColor(format) }));
}

// Titled with the hovered bar's exact dates, one row per series — with a
// colour square only when the series are formats, where the colour means
// something — a Total row when stacked, the estimated revenue (Revenue view
// only: units are always reported), and the % change vs the previous bar.
// On the total line (`formats` given) the rows are the formats, not the line.
function TrendTooltip({ active, payload: shown, granularity, metric, formats = null }) {
  if (!active || !shown?.length) return null;
  const period = shown[0].payload;
  const payload = formats ? formatRows(period, formats) : shown;
  if (!payload.length) return null;
  const total = payload.reduce((sum, item) => sum + (typeof item.value === 'number' ? item.value : 0), 0);
  const stacked = payload.length > 1;

  return (
    // ChartTooltipContent's box in the shared tooltip look; the rows are this chart's own.
    <div className={cn('grid min-w-32 items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl', CHART_TOOLTIP_CLASS)}>
      <div className="font-medium text-deep-violet-blue">{period.exactLabel}</div>
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
              {item.name === UNNAMED_FORMAT ? 'Total' : item.name}
            </span>
            {/* One series is the period's total, so it is bold like the Total row. */}
            <span className={`font-mono text-deep-violet-blue tabular-nums ${stacked ? 'font-medium' : 'font-semibold'}`}>
              {formatMetric(metric, item.value)}
            </span>
          </div>
        ))}
        {stacked && (
          <div className="mt-0.5 flex w-full items-center justify-between gap-2 border-t border-lavander pt-1">
            <span className="font-medium text-deep-violet-blue">Total</span>
            <span className="font-mono font-semibold text-deep-violet-blue tabular-nums">
              {formatMetric(metric, total)}
            </span>
          </div>
        )}
        {metric === 'revenue' && hasEstimate(period.estimated) && (
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-deep-violet-blue/70">est.</span>
            <span className="font-mono font-medium text-deep-violet-blue tabular-nums">
              {formatRevenue(period.estimated)}
            </span>
          </div>
        )}
        <TooltipChange pct={period.changePct} suffix={`vs previous ${granularity}`} />
      </div>
    </div>
  );
}

/**
 * The trend with no comparison: one bar per week/month stacked by store
 * format, in the format colours (a single-format channel is one colour).
 * Each bar is labelled by its row's own type (weekOrMonth), so a
 * month-only row is never titled as a week in the tooltip. One customer is
 * one bar per period, so past the screen's bar limit (chartKind: 12 periods
 * on desktop, 3 on a phone) it becomes one line of the period's total, like
 * one customer on the cross-customer chart; hovering a point still shows the
 * split by format.
 *
 * @param {{ periodByFormat: Array<object>, periodTotal: Array<object>, granularity: 'week' | 'month', metric?: 'revenue' | 'units' }} props
 */
export function FormatTrendChart({ periodByFormat, periodTotal, granularity, metric = 'revenue' }) {
  const mobile = useMediaQuery('(max-width: 639px)');
  const formats = sortFormatsByTotalDesc(periodByFormat);
  const unnamedOnly = formats.length === 1 && formats[0] === UNNAMED_FORMAT;
  const chartConfig = Object.fromEntries(formats.map((format) => [format, { label: format, color: formatColor(format) }]));
  const chartData = pivotByFormat(periodByFormat, periodTotal, metric);
  const axisProps = mobile ? yearAxisProps(chartData, 'periodStart') : periodAxisProps(chartData, granularity);
  // On a phone the axis is labelled by year (yearAxisProps), so no month axis.
  const monthGroups = mobile ? null : weekMonthGroups(chartData, granularity);
  const kind = trendChartKind({ customerCount: 1, periodCount: chartData.length, mobile });
  // Bars stack the formats; the line is the period's total.
  const valueKeys = kind === 'bars' ? formats : [TOTAL_KEY];
  const yAxisProps = metricYAxisProps(metric, chartDataRange(chartData, valueKeys, { stacked: kind === 'bars' }));
  // A change (Revenue / Volume) moves the bars or line and the axis together.
  const transition = useChartTransition({
    rows: chartData,
    rowKey: 'period_label',
    valueKeys,
    domain: yAxisProps.domain,
    ticks: yAxisProps.ticks,
  });
  const yAxis = <YAxis {...yAxisProps} domain={transition.domain} ticks={transition.ticks} />;
  // Tilted labels run down-left from their bar, so the first needs room past
  // the y-axis; a line's last point sits on the plot's right edge.
  const margin = {
    top: CHART_TOP_MARGIN,
    bottom: 8,
    ...(axisProps.angle ? { left: TILTED_LABEL_LEFT_MARGIN } : {}),
    ...(kind === 'lines' ? { right: 16 } : {}),
  };
  const tooltip = (
    // Above the legend, which is drawn after it and would show through.
    <ChartTooltip content={<TrendTooltip granularity={granularity} metric={metric} />} wrapperStyle={{ zIndex: 10 }} />
  );

  if (kind === 'lines') {
    // One line, so no legend: the tooltip names the formats.
    return (
      <ChartFrame fill>
        <ChartContainer config={{ [TOTAL_KEY]: { label: 'Total', color: TOTAL_LINE_COLOR } }} className={CHART_SIZE_CLASS}>
          <LineChart accessibilityLayer data={transition.rows} margin={margin}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey={mobile ? 'periodStart' : 'displayLabel'} {...axisProps} padding={{ left: 24, right: 24 }} />
            {yAxis}
            <MonthAxis groups={monthGroups} />
            <ChartTooltip
              content={<TrendTooltip granularity={granularity} metric={metric} formats={formats} />}
              wrapperStyle={{ zIndex: 10 }}
            />
            <Line
              dataKey={TOTAL_KEY}
              name="Total"
              type="linear"
              stroke={`var(--color-${TOTAL_KEY})`}
              strokeWidth={2}
              dot={chartData.length > MAX_DOTTED_POINTS ? false : { r: 2.5 }}
              activeDot={{ r: 4 }}
              {...transition.seriesAnimation}
            />
          </LineChart>
        </ChartContainer>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame fill>
      <ChartContainer config={chartConfig} className={CHART_SIZE_CLASS}>
        {/* stackOffset="sign": a negative segment (returns) is drawn down from 0,
            not on top of the positive ones (chartDataRange measures it that way). */}
        <BarChart accessibilityLayer data={transition.rows} margin={margin} stackOffset="sign">
          <CartesianGrid vertical={false} />
          <XAxis dataKey={mobile ? 'periodStart' : 'displayLabel'} {...axisProps} />
          {yAxis}
          <MonthAxis groups={monthGroups} />
          {tooltip}
          {!unnamedOnly && <ChartLegend content={<ChartLegendContent />} />}
          {formats.map((format) => (
            <Bar
              key={format}
              dataKey={format}
              stackId="format"
              fill={`var(--color-${format})`}
              maxBarSize={MAX_BAR_SIZE}
              {...BAR_ANIMATION}
              {...transition.seriesAnimation}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
