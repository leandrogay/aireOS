'use client';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import ComparisonTooltip from '@/components/dashboard/ComparisonTooltip';
import MonthAxis from '@/components/dashboard/MonthAxis';
import {
  CHART_SIZE_CLASS,
  CHART_TOP_MARGIN,
  MAX_DOTTED_POINTS,
  TILTED_LABEL_LEFT_MARGIN,
  chartDataRange,
  metricYAxisProps,
  periodAxisProps,
  weekMonthGroups,
} from '@/app/utils/trendChart';
import useChartTransition from '@/hooks/useChartTransition';

// One colour for both periods, so the eye compares the two lines rather
// than reading them as two different things: this period solid, the
// comparison dashed and lighter -- the line form of the bar chart's solid vs
// hatched stacks.
const LINE_COLOR = 'var(--aire-deep-blue)';
const BASELINE_DASH = '5 4';
const BASELINE_OPACITY = 0.5;

function LineSwatch({ dashed }) {
  return (
    <svg width="22" height="8" aria-hidden="true">
      <line
        x1="1"
        x2="21"
        y1="4"
        y2="4"
        stroke={LINE_COLOR}
        strokeWidth="2"
        strokeDasharray={dashed ? BASELINE_DASH : undefined}
        strokeOpacity={dashed ? BASELINE_OPACITY : 1}
      />
    </svg>
  );
}

/**
 * A long comparison (more than MAX_BAR_PERIODS buckets, see
 * ComparisonMixChart) as two lines of totals: this period solid, the
 * comparison dashed, paired bucket by bucket so the gap between them is the
 * change. Store formats are not drawn as lines (4 formats x 2 periods would
 * be 8); hovering a point shows each format for both periods
 * (ComparisonTooltip), and the Sell-out Summary below breaks the period down
 * by format. A long run of weeks gets the month axis (MonthAxis).
 *
 * @param {{
 *   points: Array<object>,
 *   formats: string[],
 *   names: { current: string, baseline: string },
 *   granularity: 'week' | 'month',
 *   metric: 'revenue' | 'units',
 * }} props `points` as ComparisonMixChart builds them (totals, labels and per-format figures per bucket)
 */
export default function ComparisonLineChart({ points, formats, names, granularity, metric }) {
  const axisProps = periodAxisProps(points, granularity);
  const monthGroups = weekMonthGroups(points, granularity);
  const yAxisProps = metricYAxisProps(
    metric,
    chartDataRange(points, ['currentTotal', 'baselineTotal'], { stacked: false }),
  );
  // A change (Revenue / Volume) moves both lines and the axis together.
  const transition = useChartTransition({
    rows: points,
    rowKey: 'axisStart',
    valueKeys: ['currentTotal', 'baselineTotal'],
    domain: yAxisProps.domain,
    ticks: yAxisProps.ticks,
  });
  const dot = points.length > MAX_DOTTED_POINTS ? false : { r: 2.5 };
  const margin = {
    top: CHART_TOP_MARGIN,
    bottom: 8,
    right: 16,
    ...(axisProps.angle ? { left: TILTED_LABEL_LEFT_MARGIN } : {}),
  };

  return (
    <>
      <ChartContainer config={{}} className={CHART_SIZE_CLASS}>
        <LineChart accessibilityLayer data={transition.rows} margin={margin}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="displayLabel" {...axisProps} padding={{ left: 24, right: 24 }} />
          <YAxis {...yAxisProps} domain={transition.domain} ticks={transition.ticks} />
          <MonthAxis groups={monthGroups} />
          <ChartTooltip content={<ComparisonTooltip formats={formats} metric={metric} />} wrapperStyle={{ zIndex: 10 }} />
          {/* The comparison first, so this period's solid line is drawn on top. */}
          <Line
            dataKey="baselineTotal"
            type="linear"
            stroke={LINE_COLOR}
            strokeWidth={2}
            strokeDasharray={BASELINE_DASH}
            strokeOpacity={BASELINE_OPACITY}
            dot={dot && { ...dot, strokeOpacity: BASELINE_OPACITY }}
            activeDot={{ r: 4 }}
            {...transition.seriesAnimation}
          />
          <Line
            dataKey="currentTotal"
            type="linear"
            stroke={LINE_COLOR}
            strokeWidth={2}
            dot={dot}
            activeDot={{ r: 4 }}
            {...transition.seriesAnimation}
          />
        </LineChart>
      </ChartContainer>
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 pt-2 text-xs text-deep-violet-blue">
        <span className="flex items-center gap-1.5 font-medium">
          <LineSwatch />
          {names.current}
        </span>
        <span className="flex items-center gap-1.5 text-deep-violet-blue/70">
          <LineSwatch dashed />
          {names.baseline}
        </span>
      </div>
    </>
  );
}
