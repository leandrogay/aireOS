"use client"

import { Loader2 } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ChartContainer,
  ChartTooltip,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { changePct, formatChangePct, formatWeekRange } from "@/app/utils/periodComparison"

// AIRE palette assigned per store format. Reused across offline (4 series)
// and online (1 series) since only one mode's chart is ever on screen at once
// — safe to reuse HYPER's color for FPON since they never render together.
// FPON previously used --aire-cream, which is nearly invisible against the
// white card/cream page background.
const FORMAT_COLORS = {
  HYPER: "var(--aire-deep-blue)",
  SUPER: "var(--aire-violet)",
  FINEST: "var(--aire-celest)",
  UNITY: "var(--aire-lavender)",
  FPON: "var(--aire-deep-blue)",
}

const fallbackChartConfig = {
  revenue: { label: "Revenue", color: "var(--aire-deep-blue)" },
}

// Labels are filled in per render with the two periods' names
// ("Aug 2026" / "Aug 2025") — see ComparisonTrend.
const comparisonChartConfig = {
  current: { label: "This period", color: "var(--aire-deep-blue)" },
  baseline: { label: "Comparison", color: "var(--aire-lavender)" },
}

const tabTriggerClass =
  "text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white"

function displayLabelFor(periodLabel, periodStart) {
  if (!periodLabel.startsWith("Week ")) return periodLabel
  return formatWeekRange(periodStart)
}

// Baseline weeks are often last year's, so their label carries the year.
function baselineLabelFor(row) {
  const label = displayLabelFor(row.period_label, row.period_start)
  return row.period_label.startsWith("Week ") ? `${label}, ${row.period_start.slice(0, 4)}` : label
}

function formatAxisCurrency(value) {
  if (typeof value !== "number") return value
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`
  }
  return `$${value}`
}

function ChangeText({ pct, suffix }) {
  if (pct === null || pct === undefined) return null
  const color = pct > 0 ? "text-green-600" : pct < 0 ? "text-red-600" : "text-deep-violet-blue"
  return (
    <div className={`mt-0.5 border-t border-lavander pt-1 font-medium ${color}`}>
      {pct > 0 ? "▲ " : pct < 0 ? "▼ " : ""}
      {formatChangePct(pct)} {suffix}
    </div>
  )
}

// Reshapes the flat [{ period_label, period_start, format, revenue }] rows
// the API returns into one row per period with a column per format, which
// is the shape Recharts needs for a stacked bar, plus each period's % change
// vs the one before it (from `periodTotal`) for the tooltip.
function pivotByFormat(periodByFormat, periodTotal) {
  const byPeriod = new Map()
  for (const row of periodByFormat) {
    if (!byPeriod.has(row.period_label)) {
      byPeriod.set(row.period_label, {
        period_label: row.period_label,
        displayLabel: displayLabelFor(row.period_label, row.period_start),
      })
    }
    byPeriod.get(row.period_label)[row.format] = row.revenue
  }
  periodTotal.forEach((row, index) => {
    const period = byPeriod.get(row.period_label)
    if (period && index > 0) period.changePct = changePct(row.revenue, periodTotal[index - 1].revenue)
  })
  return [...byPeriod.values()]
}

// Stack order for the per-format bar: Recharts stacks <Bar> elements bottom-up
// in the order they're rendered, and that order is fixed across every bar in
// the chart (it can't vary per period) — so this picks one order for the
// whole chart, ranked by each format's total revenue across all periods
// combined, largest first. That puts the biggest, steadiest segment at the
// bottom (a stable visual base) and the smaller ones stacked on top.
function sortFormatsByTotalDesc(periodByFormat) {
  const totals = new Map()
  for (const row of periodByFormat) {
    totals.set(row.format, (totals.get(row.format) ?? 0) + (row.revenue ?? 0))
  }
  return [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a))
}

// Caps how thick a bar can render — without this, Recharts stretches bars to
// fill the available width, so a chart with only one or two bars ends up with
// comically wide bars. Capping (rather than fixing) the width still lets bars
// narrow naturally as more of them need to fit, so a long range with many
// bars stays just as readable as before.
const MAX_BAR_SIZE = 56

// Custom tooltip for the stacked-by-format chart: same visual shell as the
// shared ChartTooltipContent, with an added Total row summing every format
// segment and the % change vs the previous bar.
function StackedTotalTooltip({ active, payload, label, granularity }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((sum, item) => sum + (typeof item.value === "number" ? item.value : 0), 0)

  return (
    <div className="grid min-w-32 items-start gap-1.5 rounded-lg border border-lavander bg-white px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium text-deep-violet-blue">{label}</div>
      <div className="grid gap-1.5">
        {payload.map((item, index) => (
          <div key={index} className="flex w-full items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-deep-violet-blue/70">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color ?? item.payload?.fill }}
              />
              {item.name}
            </span>
            <span className="font-mono font-medium text-deep-violet-blue tabular-nums">
              ${Number(item.value).toLocaleString()}
            </span>
          </div>
        ))}
        {payload.length > 1 && (
          <div className="mt-0.5 flex w-full items-center justify-between gap-2 border-t border-lavander pt-1">
            <span className="font-medium text-deep-violet-blue">Total</span>
            <span className="font-mono font-semibold text-deep-violet-blue tabular-nums">
              ${total.toLocaleString()}
            </span>
          </div>
        )}
        <ChangeText pct={payload[0].payload.changePct} suffix={`vs previous ${granularity}`} />
      </div>
    </div>
  )
}

// Tooltip for the side-by-side comparison: each row is named after its
// period (the legend names, e.g. "Aug 2026" / "Aug 2025") with its revenue.
// The comparison bar is often a different week than the axis shows (Aug 7 –
// 13 last year, or a whole other week for "previous period"), so its own
// dates sit underneath in small print.
function ComparisonTooltip({ active, payload, names }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const sides = [
    { key: "current", name: names.current, value: row.current, dates: null },
    { key: "baseline", name: names.baseline, value: row.baseline, dates: row.baselineLabel },
  ]

  return (
    <div className="grid min-w-44 gap-1 rounded-lg border border-lavander bg-white px-2.5 py-1.5 text-xs text-deep-violet-blue shadow-xl">
      <div className="text-deep-violet-blue/60">{row.axisLabel}</div>
      {sides.map((side) => (
        <div key={side.key}>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 font-medium">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: comparisonChartConfig[side.key].color }}
              />
              {side.name}
            </span>
            <span className="font-mono font-medium tabular-nums">
              {side.value === null ? "No data" : `$${side.value.toLocaleString()}`}
            </span>
          </div>
          {side.dates && <div className="pl-4 text-deep-violet-blue/50">{side.dates}</div>}
        </div>
      ))}
      <ChangeText pct={row.current !== null ? changePct(row.current, row.baseline) : null} suffix={`vs ${names.baseline}`} />
    </div>
  )
}

// Fixed-height so the card doesn't jump when loading gives way to the chart
// — matches the chart's own h-[220px].
function ChartLoading({ label }) {
  return (
    <div className="flex h-[220px] w-full flex-col items-center justify-center gap-2 text-deep-violet-blue/60">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

/**
 * Revenue trend card: offline/online mode switch, an optional `headerExtra`
 * slot beside it (page.js puts the Period and Compare to controls there, so
 * the timeframe is read before the chart), a By week / By month switch, and
 * the revenue chart. Data comes from the shared useDashboardSummary hook
 * (called in page.js) so this and RevenueSummaryCards don't each fetch the
 * same data independently.
 *
 * With no comparison the chart is the per-store-format stacked view. With a
 * comparison it shows this period's total beside the baseline's, bucket by
 * bucket — `comparisonRows` comes pre-aligned from alignComparisonBuckets
 * (week 1 with week 1), so the chart only renders.
 */
export default function RevenueTrendCard({
  summaryByMode = {},
  loading = false,
  refreshing = false,
  error = null,
  freshnessRefreshing = false,
  lastUpdated = null,
  mode = "offline",
  onModeChange = () => {},
  headerExtra = null,
  granularity = "week",
  onGranularityChange = () => {},
  comparisonRows = null,
  comparisonLoading = false,
  periodNames = null,
}) {
  const salesData = summaryByMode[mode]
  const busy = loading || (comparisonRows !== null && comparisonLoading)

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <div className="flex flex-wrap items-end gap-3 mb-2">
        <Tabs value={mode} onValueChange={onModeChange}>
          <TabsList className="bg-lavander">
            <TabsTrigger value="offline" className={tabTriggerClass}>
              Offline
            </TabsTrigger>
            <TabsTrigger value="online" className={tabTriggerClass}>
              Online
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {headerExtra && <div className="ml-auto">{headerExtra}</div>}
      </div>

      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs text-deep-violet-blue/60">
          {(refreshing || freshnessRefreshing) && "Refreshing latest data…"}
        </p>
        <Tabs value={granularity} onValueChange={onGranularityChange}>
          <TabsList className="h-7 bg-lavander">
            <TabsTrigger value="week" className={`text-xs ${tabTriggerClass}`}>
              By week
            </TabsTrigger>
            <TabsTrigger value="month" className={`text-xs ${tabTriggerClass}`}>
              By month
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {busy && <ChartLoading label="Loading dashboard..." />}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!busy && !error && salesData && (
        <div>
          {comparisonRows ? (
            <ComparisonTrend rows={comparisonRows} periodNames={periodNames} />
          ) : (
            <RevenueTrend
              periodByFormat={salesData.periodByFormat}
              periodTotal={salesData.periodTotal}
              granularity={granularity}
            />
          )}
          <p className="mt-1 text-right text-xs text-deep-violet-blue/60">
            Last Updated: {lastUpdated || "—"}
          </p>
        </div>
      )}
    </div>
  )
}

// This period vs the comparison, one pair of bars per aligned bucket. The
// legend names the two periods, the x-axis this period's bucket, and the
// tooltip both sides' buckets.
function ComparisonTrend({ rows, periodNames }) {
  const chartConfig = {
    current: { ...comparisonChartConfig.current, label: periodNames?.current || comparisonChartConfig.current.label },
    baseline: { ...comparisonChartConfig.baseline, label: periodNames?.baseline || comparisonChartConfig.baseline.label },
  }
  const chartData = rows.map((row) => ({
    axisLabel: row.current
      ? displayLabelFor(row.current.period_label, row.current.period_start)
      : `#${row.index + 1}`,
    baselineLabel: row.baseline ? baselineLabelFor(row.baseline) : null,
    current: row.current?.revenue ?? null,
    baseline: row.baseline?.revenue ?? null,
  }))

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="axisLabel" />
        <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
        <ChartTooltip
          content={<ComparisonTooltip names={{ current: chartConfig.current.label, baseline: chartConfig.baseline.label }} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="baseline" fill="var(--color-baseline)" radius={[4, 4, 0, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false} />
        <Bar dataKey="current" fill="var(--color-current)" radius={[4, 4, 0, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

// FALLBACK: renders a single-series line while periodByFormat is empty (e.g.
// online mode currently has no per-format breakdown), otherwise the real
// stacked-bar-per-format view.
function RevenueTrend({ periodByFormat, periodTotal, granularity }) {
  if (periodByFormat.length === 0) {
    const lineData = periodTotal.map((row, index) => ({
      ...row,
      displayLabel: displayLabelFor(row.period_label, row.period_start),
      changePct: index > 0 ? changePct(row.revenue, periodTotal[index - 1].revenue) : null,
    }))
    return (
      <ChartContainer config={fallbackChartConfig} className="h-[220px] w-full">
        <LineChart accessibilityLayer data={lineData} margin={{ bottom: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="displayLabel" />
          <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
          <ChartTooltip content={<StackedTotalTooltip granularity={granularity} />} />
          <Line
            dataKey="revenue"
            name="Revenue"
            stroke="var(--color-revenue)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    )
  }

  const formats = sortFormatsByTotalDesc(periodByFormat)
  const chartConfig = Object.fromEntries(
    formats.map((format) => [format, { label: format, color: FORMAT_COLORS[format] }])
  )
  const chartData = pivotByFormat(periodByFormat, periodTotal)

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="displayLabel" />
        <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
        <ChartTooltip content={<StackedTotalTooltip granularity={granularity} />} />
        <ChartLegend content={<ChartLegendContent />} />
        {formats.map((format, index) => (
          <Bar
            key={format}
            dataKey={format}
            stackId="format"
            fill={`var(--color-${format})`}
            radius={index === formats.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={MAX_BAR_SIZE}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
