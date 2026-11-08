'use client';

import { Fragment, useId } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { formatColor as colorFor, UNNAMED_FORMAT } from '@/app/utils/storeFormats';
import { MAX_BAR_PERIODS } from '@/app/utils/customerTrend';
import ComparisonLineChart from '@/components/dashboard/ComparisonLineChart';
import ComparisonTooltip from '@/components/dashboard/ComparisonTooltip';
import { HatchPattern, PeriodSwatch, edgeColor, hatchTint, patternId } from '@/components/dashboard/PeriodTexture';
import {
  CHART_SIZE_CLASS,
  BAR_ANIMATION,
  MAX_BAR_SIZE,
  bucketLabel,
  exactBucketLabel,
  chartDataMax,
  metricYAxisProps,
  CHART_TOP_MARGIN,
  TILTED_LABEL_LEFT_MARGIN,
  comparisonAxisProps,
  yearAxisProps,
  sortFormatsByTotalDesc,
} from '@/app/utils/trendChart';
import useMediaQuery from '@/hooks/useMediaQuery';

// The comparison period is drawn in the same format colours as this period,
// hatched (see PeriodTexture): a 50% tint with stripes and an outline in the
// format's darker edge colour. This period's segments are solid with the
// same edge, so a pale segment (UNITY) still has a visible boundary.

// The x-axis labels, one per bar: this period's centred under its solid
// stack and the comparison's (muted) under its hatched stack, on one shared
// baseline. Drawn as the label of an empty, zero-height bar at the bottom of
// each stack, so Recharts hands over that stack's exact x and width; an axis
// tick has only one position per bucket. Every label is shown, tilted by
// `tilt` (comparisonAxisProps' angle) so neighbours don't overlap — not
// named `angle`, which Recharts' Label sets to 0 when it clones this element.
// `points` is the chart data and `field` the label to show.
function BarAxisLabel({ x, y, width, height, index, points, field, muted = false, tilt = 0 }) {
  const text = points[index]?.[field];
  if (!text) return null;
  return (
    <text
      transform={`translate(${x + width / 2},${y + height + 10})${tilt ? ` rotate(${tilt})` : ''}`}
      textAnchor={tilt ? 'end' : 'middle'}
      dominantBaseline="hanging"
      fontSize={12}
      className={muted ? 'fill-muted-foreground opacity-70' : 'fill-muted-foreground'}
    >
      {text}
    </text>
  );
}

// One row per period, this period first (matching the bars): its name, then
// each format it has sales for, with the swatch its bars are drawn in —
// solid for this period, hatched for the comparison. A grid, so both rows'
// formats start at the same place.
function MixLegend({ rows, names }) {
  return (
    <div className="flex justify-center pt-2">
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs text-deep-violet-blue">
        {rows.map((row) => (
          <Fragment key={row.key}>
            <span className={row.hatched ? 'text-deep-violet-blue/70' : 'font-medium'}>{names[row.key]}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l border-lavander pl-3">
              {row.formats.length === 0 && <span className="text-deep-violet-blue/50">No sales data</span>}
              {row.formats.filter((format) => format !== UNNAMED_FORMAT).map((format) => (
                <span key={format} className="flex items-center gap-1.5">
                  <PeriodSwatch color={colorFor(format)} tint={hatchTint(colorFor(format))} hatched={row.hatched} />
                  {format}
                </span>
              ))}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// Formats with sales on one side of the chart, in the chart's stack order.
function formatsWithSales(formats, rows, side) {
  return formats.filter((format) => rows.some((row) => (row[side][format] ?? 0) !== 0));
}

/**
 * The comparison chart: per bucket, the comparison
 * period's stack (hatched, right) beside this period's (solid, left), each
 * split by store format. `rows` come from alignComparisonBuckets, whose
 * `currentFormats` / `baselineFormats` hold `metric` (revenue or units, the
 * same one passed there) per format for the paired weeks, so both stacks
 * cover exactly matching weeks.
 *
 * @param {{
 *   rows: Array<{ axisStart: string, current: object | null, baseline: object | null,
 *     currentFormats: Record<string, number>, baselineFormats: Record<string, number> }>,
 *   periodNames: { current: string, baseline: string },
 *   granularity: 'week' | 'month',
 *   metric?: 'revenue' | 'units',
 * }} props
 */
export default function ComparisonMixChart({ rows, periodNames, granularity, metric = 'revenue' }) {
  const mobile = useMediaQuery('(max-width: 639px)');
  const baseId = useId();
  const formats = sortFormatsByTotalDesc(
    rows
      .flatMap((row) => [...Object.entries(row.currentFormats), ...Object.entries(row.baselineFormats)])
      .map(([format, revenue]) => ({ format, revenue })),
  );
  const names = { current: periodNames?.current || 'This period', baseline: periodNames?.baseline || 'Comparison' };
  const chartData = rows.map((row) => {
    const point = {
      axisStart: row.axisStart,
      baselineStart: row.baseline?.firstWeekStart ?? '',
      axisLabel: bucketLabel(granularity, row.axisStart),
      // For the line version's month axis (weekMonthGroups).
      displayLabel: bucketLabel(granularity, row.axisStart),
      periodStart: row.axisStart,
      currentLabel: exactBucketLabel(granularity, row.axisStart),
      baselineLabel: row.baseline?.label ?? null,
      // Short like axisLabel (no year on a week), for BarAxisLabel.
      baselineAxisLabel: row.baseline ? bucketLabel(granularity, row.baseline.firstWeekStart) : '',
      currentTotal: row.current?.[metric] ?? null,
      baselineTotal: row.baseline?.[metric] ?? null,
      currentFormats: row.currentFormats,
      baselineFormats: row.baselineFormats,
      // The empty bars BarAxisLabel hangs from.
      currentAxis: 0,
      baselineAxis: 0,
    };
    for (const format of formats) {
      point[`baseline_${format}`] = row.baselineFormats[format] ?? null;
      point[`current_${format}`] = row.currentFormats[format] ?? null;
    }
    return point;
  });

  // Past MAX_BAR_PERIODS buckets, two stacks per bucket stop reading as
  // bars (a year by week is over 100); the same limit as the customer chart
  // (customerTrend), which turns to lines there too.
  if (chartData.length > MAX_BAR_PERIODS) {
    return (
      <ComparisonLineChart
        points={chartData}
        formats={formats}
        names={names}
        granularity={granularity}
        metric={metric}
      />
    );
  }
  // The axis keeps its height and spacing, but its single tick per bucket is
  // hidden: BarAxisLabel labels each of the two stacks instead.
  const axisProps = mobile ? { interval: 0, angle: 0, height: 28 } : comparisonAxisProps(granularity);
  // Each bucket has two stacks (this period, the comparison); the axis
  // reaches the taller of them.
  const dataMax = Math.max(
    chartDataMax(chartData, formats.map((format) => `current_${format}`)),
    chartDataMax(chartData, formats.map((format) => `baseline_${format}`)),
  );
  const formatCurrentYear = yearAxisProps(chartData, 'axisStart').tickFormatter;
  const formatBaselineYear = yearAxisProps(chartData, 'baselineStart').tickFormatter;
  if (mobile) {
    chartData.forEach((point) => {
      point.mobileCurrentYear = formatCurrentYear(point.axisStart);
      point.mobileBaselineYear = formatBaselineYear(point.baselineStart);
    });
  }
  const axisLabel = (field, muted) => (
    <BarAxisLabel points={chartData} field={field} muted={muted} tilt={axisProps.angle} />
  );

  return (
    <>
      <ChartContainer config={{}} className={CHART_SIZE_CLASS}>
        <BarChart accessibilityLayer data={chartData} margin={{ top: CHART_TOP_MARGIN, bottom: 8, left: TILTED_LABEL_LEFT_MARGIN }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="axisLabel"
            {...axisProps}
            tick={false}
          />
          <YAxis {...metricYAxisProps(metric, dataMax)} />
          <ChartTooltip content={<ComparisonTooltip formats={formats} metric={metric} />} />
          <defs>
            {formats.map((format) => (
              <HatchPattern
                key={format}
                id={patternId(baseId, format)}
                tint={hatchTint(colorFor(format))}
                stripe={edgeColor(colorFor(format))}
              />
            ))}
          </defs>
          {/* Recharts places stacks left to right in the order their first
              bar is rendered: this period first, matching the Period /
              Compare to controls above. Each stack starts with an empty
              bar that carries its x-axis label; minPointSize keeps it as an
              invisible 1px bar, since Recharts drops a zero-value bar (and
              its label) entirely. Those label bars stay unanimated, since
              Recharts holds a bar's labels back until its animation ends;
              only the data bars grow. */}
          <Bar
            dataKey="currentAxis"
            stackId="current"
            fill="none"
            minPointSize={1}
            isAnimationActive={false}
            label={axisLabel(mobile ? 'mobileCurrentYear' : 'axisLabel', false)}
          />
          {formats.map((format) => (
            <Bar
              key={`current_${format}`}
              dataKey={`current_${format}`}
              stackId="current"
              fill={colorFor(format)}
              stroke={edgeColor(colorFor(format))}
              strokeWidth={1}
              maxBarSize={MAX_BAR_SIZE}
              {...BAR_ANIMATION}
            />
          ))}
          <Bar
            dataKey="baselineAxis"
            stackId="baseline"
            fill="none"
            minPointSize={1}
            isAnimationActive={false}
            label={axisLabel(mobile ? 'mobileBaselineYear' : 'baselineAxisLabel', true)}
          />
          {formats.map((format) => (
            <Bar
              key={`baseline_${format}`}
              dataKey={`baseline_${format}`}
              stackId="baseline"
              fill={`url(#${patternId(baseId, format)})`}
              stroke={edgeColor(colorFor(format))}
              strokeWidth={1}
              maxBarSize={MAX_BAR_SIZE}
              {...BAR_ANIMATION}
            />
          ))}
        </BarChart>
      </ChartContainer>
      <MixLegend
        names={names}
        rows={[
          { key: 'current', hatched: false, formats: formatsWithSales(formats, rows, 'currentFormats') },
          { key: 'baseline', hatched: true, formats: formatsWithSales(formats, rows, 'baselineFormats') },
        ]}
      />
    </>
  );
}
