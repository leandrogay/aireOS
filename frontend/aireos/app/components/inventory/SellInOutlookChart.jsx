'use client';

import { useState } from 'react';
import { CartesianGrid, ComposedChart, Dot, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import ChartZoomButton from '@/components/ui/ChartZoomButton';
import LineToggle from '@/components/ui/LineToggle';
import useChartZoom from '@/hooks/useChartZoom';

import { FORECAST_SERIES } from '@/app/utils/forecastView';
import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { dotRevealDelay, lineSweepTimings } from '@/app/utils/lineAnimation';
import { currentLineValues } from '@/app/utils/sellInOutlookLines';
import { AXIS_TICK, chartDataRange, metricYAxisProps, yearAxisProps } from '@/app/utils/trendChart';
import useChartTransition from '@/hooks/useChartTransition';
import useMediaQuery from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

import { labelledTooltipRow } from './chartTooltip';
import LastMonthDifference from './LastMonthDifference';
import SellInComparison from './SellInComparison';

// Every line has its own hue, spread around the colour wheel so the eight
// read apart at a glance (every pair clears the dataviz validator's
// normal-vision floor). Colour alone can't separate eight lines for
// colour-blind readers (it fails the validator's CVD check), so the line style
// says which forecast a line comes from, the same for sell-in and sell-out:
// solid with dots = actual, short dashes = Current, long dashes = Previous,
// dots = Initial; and the toggles show only the lines being compared.
const FORECAST_LINE = Object.fromEntries(FORECAST_SERIES.map((series) => [series.key, series]));

const DASH = {
  current: FORECAST_LINE.current.dash,
  previous: FORECAST_LINE.previous.dash,
  initial: FORECAST_LINE.initial.dash,
  // The building blocks overlay: dash-dot, a style no other line uses.
  blocks: '9 3 2 3',
};

// The building blocks overlay's lines take the colour of the Current line they
// adjust, with their own dash-dot: no tenth colour stays distinct from the
// other eight (dataviz palette validator), and the shared colour reads as
// "this Current line, with the blocks".
const SELL_IN_CURRENT_COLOR = '#0B4FD9';
const SELL_OUT_CURRENT_COLOR = '#00AEC2';

// `dot`: the line has a dot per month (the actual lines), so its sample does too.
// `shape: 'line'` makes LineToggle show that line sample on its pill.
const SERIES = [
  { key: 'sell_in_actual', group: 'Sell-in', label: 'Sell-in (actual)', color: '#D81B1B', dot: true },
  { key: 'sell_in_recommended', group: 'Sell-in', label: 'Sell-in Forecast (Current)', color: SELL_IN_CURRENT_COLOR, dash: DASH.current },
  {
    key: 'sell_in_with_blocks',
    group: 'Sell-in',
    label: 'Sell-in Forecast (with building blocks)',
    color: SELL_IN_CURRENT_COLOR,
    dash: DASH.blocks,
    overlay: true,
  },
  { key: 'sell_in_previous', group: 'Sell-in', label: 'Sell-in Forecast (Previous)', color: '#1E9E3A', dash: DASH.previous },
  { key: 'sell_in_initial', group: 'Sell-in', label: 'Initial Yearly Sell-in Forecast', color: '#7F4A08', dash: DASH.initial },
  { key: 'sell_out_actual', group: 'Sell-out', label: 'Sell-out (actual)', color: '#9333EA', dot: true },
  { key: 'sell_out_current', group: 'Sell-out', label: 'Sell-out Forecast (Current)', color: SELL_OUT_CURRENT_COLOR, dash: DASH.current },
  {
    key: 'sell_out_with_blocks',
    group: 'Sell-out',
    label: 'Sell-out Forecast (with building blocks)',
    color: SELL_OUT_CURRENT_COLOR,
    dash: DASH.blocks,
    overlay: true,
  },
  { key: 'sell_out_previous', group: 'Sell-out', label: 'Sell-out Forecast (Previous)', color: '#E02FA6', dash: DASH.previous },
  { key: 'sell_out_initial', group: 'Sell-out', label: 'Initial Yearly Sell-out Forecast', color: '#F58A00', dash: DASH.initial },
];

// The lines on the chart: the overlay's two only while blocks are picked.
function seriesFor(showBlocks) {
  return SERIES.filter((series) => showBlocks || !series.overlay);
}

function groupsFor(series) {
  return ['Sell-in', 'Sell-out'].map((group) => ({
    label: group,
    series: series.filter((line) => line.group === group).map((line) => ({ ...line, shape: 'line' })),
  }));
}

const CHART_CONFIG = Object.fromEntries(SERIES.map((series) => [series.key, { label: series.label, color: series.color }]));

const ALL_VISIBLE = Object.fromEntries(SERIES.map((series) => [series.key, true]));

// Why a line has nothing to show. Previous sell-in is the plan saved at each
// forecast refresh (backend sell_in_snapshots), or worked out on the previous
// sell-out forecast where none was saved, so both Previous lines are empty
// only when neither exists.
const NO_DATA_HINT = {
  sell_in_previous: 'No previous forecast yet.',
  sell_out_previous: 'No previous forecast yet.',
};

// Each line sweeps left to right: the actual parts first, then the forecasts
// carry on from where they ended.
const LINE_SWEEP = { begin: 0, duration: 1200 };

// The current sell-in and sell-out lines start from the last actual point while
// that actual line is shown, so each reads as one stroke from actual into plan
// (currentLineValues). There the
// value is the actual, not a forecast, so the tooltip leaves it out. The
// Previous and Initial lines have values of their own in the actual months
// (backend _previous_sell_in, _past_recommendations), so they never join.
const JOIN_KEYS = ['sell_in_recommended', 'sell_out_current', 'sell_in_with_blocks', 'sell_out_with_blocks'];

// Recharts' dot, faded in as the line reaches it (dotRevealDelay). `points` is
// the whole line, which is not a valid attribute for one circle.
function timedDot(timing) {
  return function TimedDot({ points, ...dotProps }) {
    const delay = dotRevealDelay(timing, points, dotProps.cx);
    return <Dot {...dotProps} className="line-dot-in" style={{ animationDelay: `${delay}ms` }} />;
  };
}

/**
 * The plan months that run on the Initial Yearly Sell-out Forecast because the
 * current forecast does not reach them yet, as a label ("Aug 2026 – Sep 2026"), or null.
 *
 * @param {Array<{ month: string, forecast_source: string | null }>} months
 * @returns {string | null}
 */
export function initialFallbackLabel(months) {
  const fallback = months.filter((row) => row.forecast_source === 'initial' || row.forecast_source === 'mixed');
  if (fallback.length === 0) return null;
  const first = formatMonth(fallback[0].month);
  const last = formatMonth(fallback[fallback.length - 1].month);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Sell-in against sell-out by month for the sell-in plan, all as lines, each
 * of which can be switched on and off. Sell-in is the actual months, then the
 * recommendation planned on the current forecast (falling back to the initial
 * where the current does not reach), the plan saved at an earlier forecast
 * refresh (Previous), and the plan on the initial alone (backend
 * get_sell_in_outlook). Previous takes, for each month, the newest plan saved
 * before it, so in the actual months it shows what was recommended then, and
 * falls back to the plan on the previous sell-out forecast where none was. The
 * Initial sell-in line also runs through the actual months, as what the
 * initial would have recommended each month. Sell-out is the actual
 * months, the current forecast carrying on from them, and the Previous and
 * Initial forecasts across the whole window, so last months' sales can be read
 * against what was forecast for them. `actualsThrough` is the last actual month.
 * The card above the chart also holds that month's sell-in and sell-out
 * against forecast (`sellInComparison`, `sellOutComparison`).
 *
 * The zoom button (hooks/useChartZoom) narrows the chart to the months
 * dragged across, and the Comparison card under it then sets their actual
 * sell-in and sell-out against forecast (SellInComparison).
 *
 * `showBlocks` adds the building blocks overlay's lines (sell_in_with_blocks,
 * sell_out_with_blocks: the plan worked out again with the picked blocks,
 * backend get_sell_in_outlook), each beside the Current line it adjusts.
 *
 * @param {{ showBlocks?: boolean, months: Array<{ month: string, sell_in_actual: number | null, sell_in_recommended: number | null, sell_in_previous: number | null, sell_in_initial: number | null, sell_out_actual: number | null, sell_out_forecast: number | null, sell_out_initial: number | null, sell_out_previous: number | null, forecast_source: 'current' | 'initial' | 'mixed' | null }>, actualsThrough: string | null, sellInComparison?: object | null, sellOutComparison?: object | null }} props
 */
export default function SellInOutlookChart({
  months,
  actualsThrough,
  sellInComparison = null,
  sellOutComparison = null,
  showBlocks = false,
}) {
  const [visible, setVisible] = useState(ALL_VISIBLE);
  const series = seriesFor(showBlocks);
  const tooltipOrder = series.map((line) => line.key);
  const mobile = useMediaQuery('(max-width: 639px)');
  // The zoom works in x-axis values, which on a phone are the months themselves.
  const zoom = useChartZoom(months.map((row) => (mobile ? row.month : formatMonth(row.month))));

  // Joined to the actuals only while their line is shown (see currentLineValues).
  const currentLines = currentLineValues(months, actualsThrough, {
    joinSellIn: visible.sell_in_actual,
    joinSellOut: visible.sell_out_actual,
  });
  const rows = months.map((row, index) => ({
    ...row,
    label: formatMonth(row.month),
    ...currentLines[index],
  }));

  // Zoomed in: only the picked months. One month alone can't draw a line,
  // so it is shown with the months either side, marked by a line.
  const singleMonth = zoom.zoomed && zoom.start === zoom.end;
  const viewStart = singleMonth ? Math.max(zoom.start - 1, 0) : zoom.start;
  const viewEnd = singleMonth ? Math.min(zoom.end + 1, rows.length - 1) : zoom.end;
  const shownRows = rows.slice(viewStart, viewEnd + 1);

  // A line with no values in view (no Previous forecast yet, or none in the
  // zoomed months) can't be switched on. Its on/off choice is kept, so it
  // comes back as it was on zooming out.
  const hasValues = (inRows, key) => inRows.some((row) => row[key] != null);
  const noData = Object.fromEntries(series.map((line) => [line.key, !hasValues(shownRows, line.key)]));

  // Fixed nice steps reaching the lines being shown, so a filter change, a
  // zoom or a toggle can move them and the axis together. Hooks stay above
  // the empty check below: they must run on every render.
  const shownKeys = series.filter((line) => visible[line.key] && !noData[line.key]).map((line) => line.key);
  const yAxisProps = metricYAxisProps('units', chartDataRange(shownRows, shownKeys, { stacked: false }));
  const transition = useChartTransition({
    rows: shownRows,
    rowKey: 'month',
    valueKeys: tooltipOrder,
    domain: yAxisProps.domain,
    ticks: yAxisProps.ticks,
  });

  if (months.length === 0) {
    return <p className="text-sm text-deep-violet-blue/70">No actuals for these filters.</p>;
  }

  const hints = Object.fromEntries(
    series.filter((line) => noData[line.key]).map((line) => [
      line.key,
      hasValues(rows, line.key)
        ? 'No values in the zoomed months.'
        : (NO_DATA_HINT[line.key] ?? 'No values for these filters.'),
    ]),
  );
  const pickedMonths = months.slice(zoom.start, zoom.end + 1);
  const timings = lineSweepTimings(shownRows, tooltipOrder, LINE_SWEEP);

  const formatRow = labelledTooltipRow(CHART_CONFIG, (value) => `${formatUnits(value)} units`);
  function formatTooltipRow(value, name, item, index, payload) {
    if (JOIN_KEYS.includes(name) && payload?.month === actualsThrough) return null;
    return formatRow(value, name, item);
  }

  const fallback = initialFallbackLabel(months);

  return (
    <div className="space-y-2">
      {/* One card: last month's differences, then the line pills, one row
          each for sell-in and sell-out. */}
      <LineToggle
        groups={groupsFor(series)}
        visible={visible}
        onToggle={(key) => setVisible((shown) => ({ ...shown, [key]: !shown[key] }))}
        hints={hints}
        disabled={noData}
        header={
          sellInComparison || sellOutComparison ? (
            <LastMonthDifference sellIn={sellInComparison} sellOut={sellOutComparison} />
          ) : null
        }
      />

      <div className="relative overflow-visible rounded-xl border border-lavander bg-white pl-1 pr-3 pt-2">
        {/* Top right, in the space the chart's top margin leaves, its right
            edge in line with the end of the plot (the chart's right margin
            plus the card's padding). */}
        <div className="absolute right-5 top-2 z-10">
          <ChartZoomButton
            picking={zoom.picking}
            zoomed={zoom.zoomed}
            onPick={zoom.startPicking}
            onCancel={zoom.cancelPicking}
            onReset={zoom.reset}
            align="end"
          />
        </div>
        <ChartContainer
          config={CHART_CONFIG}
          className={cn('aspect-auto h-[360px] w-full', zoom.picking && 'cursor-crosshair select-none')}
        >
          <ComposedChart
            accessibilityLayer
            data={transition.rows}
            margin={{ top: 40, right: 8, left: 0, bottom: 8 }}
            {...zoom.chartHandlers}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey={mobile ? 'month' : 'label'}
              interval={0}
              height={mobile ? 28 : 52}
              tick={AXIS_TICK}
              angle={mobile ? 0 : -40}
              textAnchor={mobile ? 'middle' : 'end'}
              tickMargin={6}
              {...(mobile ? yearAxisProps(shownRows, 'month') : {})}
            />
            <YAxis
              domain={transition.domain}
              ticks={transition.ticks}
              width={48}
              tick={AXIS_TICK}
              tickFormatter={formatUnits}
            />
            <ChartTooltip
              wrapperStyle={{ zIndex: 10 }}
              itemSorter={(item) => tooltipOrder.indexOf(item.dataKey)}
              content={<ChartTooltipContent className="border-violet/40 bg-white" formatter={formatTooltipRow} />}
            />
            {singleMonth ? (
              <ReferenceLine x={mobile ? rows[zoom.start].month : rows[zoom.start].label} stroke="var(--aire-violet)" strokeWidth={1.5} strokeDasharray="4 3" />
            ) : null}
            {zoom.dragging ? (
              <ReferenceArea
                x1={zoom.dragging.from}
                x2={zoom.dragging.to}
                fill="var(--aire-lavender)"
                fillOpacity={0.6}
                ifOverflow="extendDomain"
              />
            ) : null}
            {series.map((line) => (
              <Line
                key={line.key}
                dataKey={line.key}
                hide={!visible[line.key] || noData[line.key]}
                stroke={`var(--color-${line.key})`}
                strokeWidth={2}
                strokeDasharray={line.dash}
                dot={line.dot ? timedDot(timings[line.key]) : false}
                connectNulls={false}
                {...timings[line.key]}
                {...transition.seriesAnimation}
              />
            ))}
          </ComposedChart>
        </ChartContainer>
      </div>
      {fallback ? (
        <p className="text-[11px] text-deep-violet-blue/60">
          {fallback}: no current forecast yet, so the plan uses the Initial Yearly Sell-out Forecast for{' '}
          {fallback.includes('–') ? 'these months' : 'this month'}.
        </p>
      ) : null}
      {zoom.zoomed ? <SellInComparison months={pickedMonths} /> : null}
    </div>
  );
}
