"use client"

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"

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

const comparisonChartConfig = {
  current: { label: "Current", color: "var(--aire-deep-blue)" },
  previous: { label: "Previous", color: "var(--aire-lavender)" },
}

// Formats a week's period_start as its actual calendar date range, e.g.
// "Sep 3 – Sep 9" (or "Sep 3, 2026 – Sep 9, 2026" with includeYear).
function formatWeekRange(periodStart, { includeYear = false } = {}) {
  if (!periodStart) return ""
  const start = new Date(`${periodStart}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts = includeYear
    ? { month: "short", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric" }
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}`
}

function displayLabelFor(periodLabel, periodStart) {
  if (!periodLabel.startsWith("Week ")) return periodLabel
  return formatWeekRange(periodStart)
}

function formatAxisCurrency(value) {
  if (typeof value !== "number") return value
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`
  }
  return `$${value}`
}

// Reshapes the flat [{ period_label, period_start, format, revenue }] rows
// the API returns into one row per period with a column per format, which
// is the shape Recharts needs for a stacked bar. Pure reshape — no
// sums/percentages.
function pivotByFormat(periodByFormat) {
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
// shared ChartTooltipContent, but with an added Total row summing every
// format segment for that bar — the shared component has no way to inject
// a computed row via props, so this is a small standalone component instead
// of a shared-component change.
function StackedTotalTooltip({ active, payload, label }) {
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
        <div className="mt-0.5 flex w-full items-center justify-between gap-2 border-t border-lavander pt-1">
          <span className="font-medium text-deep-violet-blue">Total</span>
          <span className="font-mono font-semibold text-deep-violet-blue tabular-nums">
            ${total.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  )
}

// Aligns the current and previous periods' weekly totals by relative
// position (1st week of each, 2nd week of each, ...) rather than actual
// calendar date, since the two periods cover different real weeks — that's
// the whole point of the comparison. Falls back gracefully if one side has
// more weeks than the other (e.g. a custom range that isn't a clean month).
function buildComparisonChartData(currentPeriodTotal, previousPeriodTotal) {
  const byStart = (rows) => [...rows].sort((a, b) => a.period_start.localeCompare(b.period_start))
  const current = byStart(currentPeriodTotal)
  const previous = byStart(previousPeriodTotal)
  const length = Math.max(current.length, previous.length)

  const rows = []
  for (let i = 0; i < length; i++) {
    const currentStart = current[i]?.period_start ?? null
    const previousStart = previous[i]?.period_start ?? null
    rows.push({
      index: i + 1,
      current: current[i]?.revenue ?? null,
      previous: previous[i]?.revenue ?? null,
      currentStart,
      previousStart,
      displayLabel: formatWeekRange(currentStart ?? previousStart),
    })
  }
  return rows
}

/**
 * Revenue trend card: offline/online mode switch and the weekly revenue
 * trend chart. Data comes from the shared useDashboardSummary hook (called
 * once in page.js) so this and RevenueSummaryCards don't each fetch the
 * same data independently. When no explicit Date Range filter is active,
 * page.js already scopes that shared fetch to the current calendar month
 * (see hooks/useDefaultDateRange.js) — this component just renders whatever it's
 * given, no client-side truncation.
 *
 * While a Period Comparison is active (see usePeriodComparison), the chart
 * switches to a side-by-side view: current vs. previous period's weekly
 * revenue, aligned by relative position rather than calendar date. The
 * per-store-format breakdown (the normal stacked view) is dropped in this
 * mode to keep two periods' worth of bars readable at once.
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
  comparisonActive = false,
  previousSummaryByMode = {},
  previousLoading = false,
}) {
  const salesData = summaryByMode[mode]
  const previousSalesData = previousSummaryByMode[mode]
  const showComparison = comparisonActive
  const comparisonReady = showComparison && salesData && previousSalesData

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <Tabs value={mode} onValueChange={onModeChange}>
          <TabsList className="bg-lavander">
            <TabsTrigger
              value="offline"
              className="text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white"
            >
              Offline
            </TabsTrigger>
            <TabsTrigger
              value="online"
              className="text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white"
            >
              Online
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {(refreshing || freshnessRefreshing) && (
          <p className="text-xs text-deep-violet-blue/60">Refreshing latest data…</p>
        )}
      </div>

      {loading && <p className="text-deep-violet-blue/70 text-sm">Loading dashboard...</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {!loading && !error && showComparison && previousLoading && (
        <p className="text-deep-violet-blue/70 text-sm">Loading comparison...</p>
      )}

      {!loading && !error && comparisonReady && (
        <div>
          <ComparisonTrend
            currentPeriodTotal={salesData.periodTotal}
            previousPeriodTotal={previousSalesData.periodTotal}
          />
          <p className="mt-1 text-right text-xs text-deep-violet-blue/60">
            Last Updated: {lastUpdated || "—"}
          </p>
        </div>
      )}

      {!loading && !error && !showComparison && salesData && (
        <div>
          <RevenueTrend periodByFormat={salesData.periodByFormat} periodTotal={salesData.periodTotal} />
          <p className="mt-1 text-right text-xs text-deep-violet-blue/60">
            Last Updated: {lastUpdated || "—"}
          </p>
        </div>
      )}
    </div>
  )
}

// Side-by-side current-vs-previous revenue chart, shown while a Period
// Comparison is active. Two ungrouped bars per relative-position tick means
function ComparisonTrend({ currentPeriodTotal, previousPeriodTotal }) {
  const chartData = buildComparisonChartData(currentPeriodTotal, previousPeriodTotal)

  function tooltipLabel(_value, payload) {
    const row = payload?.[0]?.payload
    if (!row) return null
    return (
      <div className="space-y-0.5">
        <div>{formatWeekRange(row.currentStart, { includeYear: true }) || "No data"}</div>
        <div className="text-muted-foreground">
          vs {formatWeekRange(row.previousStart, { includeYear: true }) || "No data"}
        </div>
      </div>
    )
  }

  return (
    <ChartContainer config={comparisonChartConfig} className="h-[220px] w-full">
      <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="displayLabel" interval={0} tick={{ fontSize: 10 }} />
        <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={tooltipLabel} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="current"
          fill="var(--color-current)"
          radius={4}
          maxBarSize={MAX_BAR_SIZE}
          isAnimationActive={false}
        />
        <Bar
          dataKey="previous"
          fill="var(--color-previous)"
          radius={4}
          maxBarSize={MAX_BAR_SIZE}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  )
}

// FALLBACK: renders a single-series line while periodByFormat is empty (e.g.
// online mode currently has no per-format breakdown), otherwise the real
// stacked-bar-per-format view. Only used outside comparison mode.
function RevenueTrend({ periodByFormat, periodTotal }) {
  if (periodByFormat.length === 0) {
    const lineData = periodTotal.map((row) => ({
      ...row,
      displayLabel: displayLabelFor(row.period_label, row.period_start),
    }))
    return (
      <ChartContainer config={fallbackChartConfig} className="h-[220px] w-full">
        <LineChart accessibilityLayer data={lineData} margin={{ bottom: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="displayLabel" />
          <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line
            dataKey="revenue"
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
  const chartData = pivotByFormat(periodByFormat)

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="displayLabel" />
        <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
        <ChartTooltip content={<StackedTotalTooltip />} />
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
