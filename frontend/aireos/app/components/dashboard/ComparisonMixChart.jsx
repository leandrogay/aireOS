'use client';

import { Fragment, useId } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { changePct, formatChangePct } from '@/app/utils/periodComparison';
import { formatColor as colorFor } from '@/app/utils/storeFormats';
import { HatchPattern, PeriodSwatch, edgeColor, hatchTint, patternId } from '@/components/dashboard/PeriodTexture';
import {
  CHART_SIZE_CLASS,
  MAX_BAR_SIZE,
  bucketLabel,
  exactBucketLabel,
  formatAxisCurrency,
  TILTED_LABEL_LEFT_MARGIN,
  comparisonAxisProps,
  sortFormatsByTotalDesc,
} from '@/app/utils/trendChart';

// The comparison period is drawn in the same format colours as this period,
// hatched (see PeriodTexture): a 50% tint with stripes and an outline in the
// format's darker edge colour. This period's segments are solid with the
// same edge, so a pale segment (UNITY) still has a visible boundary.

function formatMoney(value) {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function ChangeCell({ current, baseline }) {
  const pct = current === null ? null : changePct(current, baseline);
  const color =
    pct === null || pct === 0 ? 'text-deep-violet-blue/60' : pct > 0 ? 'text-green-600' : 'text-red-600';
  return (
    <td className={`pl-3 text-right tabular-nums ${color}`}>
      {pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : ''}
      {formatChangePct(pct)}
    </td>
  );
}

// One row per format — this period, the comparison and the change — and a
// Total row, as a small table: three short columns read more easily than
// eight stacked "format · period" lines. The value columns are headed by
// the hovered bar's exact dates, which also serve as the tooltip's title;
// colour squares appear only on the format rows, where colour means format.
function MixTooltip({ active, payload, formats }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const lines = formats.map((format) => ({
    format,
    current: row.currentFormats[format] ?? null,
    baseline: row.baselineFormats[format] ?? null,
  }));

  return (
    <div className="rounded-lg border border-lavander bg-white px-2.5 py-1.5 text-xs text-deep-violet-blue shadow-xl">
      <table>
        <thead>
          <tr className="align-bottom">
            <th />
            <th className="max-w-36 pb-1 pl-3 text-right font-medium leading-tight">{row.currentLabel}</th>
            <th className="max-w-36 pb-1 pl-3 text-right font-normal leading-tight text-deep-violet-blue/70">
              {row.baselineLabel ?? 'No comparison data'}
            </th>
            <th className="pb-1 pl-3 text-right font-normal text-deep-violet-blue/60">Change</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.format}>
              <td>
                <span className="flex items-center gap-1.5">
                  <PeriodSwatch color={colorFor(line.format)} />
                  {line.format}
                </span>
              </td>
              <td className="pl-3 text-right font-mono tabular-nums">
                {line.current === null ? '—' : formatMoney(line.current)}
              </td>
              <td className="pl-3 text-right font-mono tabular-nums text-deep-violet-blue/70">
                {line.baseline === null ? '—' : formatMoney(line.baseline)}
              </td>
              <ChangeCell current={line.current} baseline={line.baseline} />
            </tr>
          ))}
          <tr className="border-t border-lavander font-semibold">
            <td className="pt-1">Total</td>
            <td className="pl-3 pt-1 text-right font-mono tabular-nums">
              {row.currentTotal === null ? 'No data' : formatMoney(row.currentTotal)}
            </td>
            <td className="pl-3 pt-1 text-right font-mono tabular-nums text-deep-violet-blue/70">
              {row.baselineTotal === null ? 'No data' : formatMoney(row.baselineTotal)}
            </td>
            <ChangeCell current={row.currentTotal} baseline={row.baselineTotal} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

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
              {row.formats.map((format) => (
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
 * `currentFormats` / `baselineFormats` hold revenue per format for the
 * paired weeks, so both stacks cover exactly matching weeks.
 *
 * @param {{
 *   rows: Array<{ axisStart: string, current: object | null, baseline: object | null,
 *     currentFormats: Record<string, number>, baselineFormats: Record<string, number> }>,
 *   periodNames: { current: string, baseline: string },
 *   granularity: 'week' | 'month',
 * }} props
 */
export default function ComparisonMixChart({ rows, periodNames, granularity }) {
  const baseId = useId();
  const formats = sortFormatsByTotalDesc(
    rows
      .flatMap((row) => [...Object.entries(row.currentFormats), ...Object.entries(row.baselineFormats)])
      .map(([format, revenue]) => ({ format, revenue })),
  );
  const names = { current: periodNames?.current || 'This period', baseline: periodNames?.baseline || 'Comparison' };
  const chartData = rows.map((row) => {
    const point = {
      axisLabel: bucketLabel(granularity, row.axisStart),
      currentLabel: exactBucketLabel(granularity, row.axisStart),
      baselineLabel: row.baseline?.label ?? null,
      // Short like axisLabel (no year on a week), for BarAxisLabel.
      baselineAxisLabel: row.baseline ? bucketLabel(granularity, row.baseline.firstWeekStart) : '',
      currentTotal: row.current?.revenue ?? null,
      baselineTotal: row.baseline?.revenue ?? null,
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
  // The axis keeps its height and spacing, but its single tick per bucket is
  // hidden: BarAxisLabel labels each of the two stacks instead.
  const axisProps = comparisonAxisProps(granularity);
  const axisLabel = (field, muted) => (
    <BarAxisLabel points={chartData} field={field} muted={muted} tilt={axisProps.angle} />
  );

  return (
    <>
      <ChartContainer config={{}} className={CHART_SIZE_CLASS}>
        <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8, left: TILTED_LABEL_LEFT_MARGIN }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="axisLabel"
            {...axisProps}
            tick={false}
          />
          <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
          <ChartTooltip content={<MixTooltip formats={formats} />} />
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
              its label) entirely. */}
          <Bar
            dataKey="currentAxis"
            stackId="current"
            fill="none"
            minPointSize={1}
            isAnimationActive={false}
            label={axisLabel('axisLabel', false)}
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
              isAnimationActive={false}
            />
          ))}
          <Bar
            dataKey="baselineAxis"
            stackId="baseline"
            fill="none"
            minPointSize={1}
            isAnimationActive={false}
            label={axisLabel('baselineAxisLabel', true)}
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
              isAnimationActive={false}
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
