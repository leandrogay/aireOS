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
// "Sep 3 – Sep 9".
function formatWeekRange(periodStart) {
  if (!periodStart) return ""
  const start = new Date(`${periodStart}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts = { month: "short", day: "numeric" }
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

// Labels one side of a comparison by whatever unit that comparison type is
// actually comparing — a WoW bar is one specific week, so it gets that
// week's real date range; MoM compares whole months, so it gets the month
// name; YoY compares whole years, so it gets just the year. Each of these
// reads directly off the period's own start date (get_period_comparison
// always returns current/previous start as the *first* day of that week,
// month, or year respectively, even when the period itself is truncated to
// however much data is actually available).
function comparisonLabel(comparisonType, isoDate) {
  if (!isoDate) return ""
  const date = new Date(`${isoDate}T00:00:00`)
  if (comparisonType === "yoy") return `${date.getFullYear()}`
  if (comparisonType === "mom") return date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
  return formatWeekRange(isoDate)
}

// One bar per side, each its own x-axis category (not a shared tick) — see
// comparisonLabel — so hovering or reading the axis under a given bar
// always describes that exact bar, current and previous are never
// ambiguously overlaid on one tick the way a grouped pair would be.
// Previous (the older period) comes first/left, current (the more recent
// one) second/right, reading left-to-right in chronological order.
function buildComparisonBars(result, comparisonType) {
  const previousAvailable = Boolean(result.previous?.available)
  return [
    {
      label: previousAvailable ? comparisonLabel(comparisonType, result.previous.start) : "No data",
      current: null,
      previous: previousAvailable ? result.previous.revenue : null,
    },
    {
      label: comparisonLabel(comparisonType, result.current.start),
      current: result.current.revenue,
      previous: null,
    },
  ]
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
 * switches to a single current-vs-previous total view driven directly by
 * `comparisonResult` (the same aggregate the Period Comparison box below
 * shows) rather than the weekly summary data — WoW's "current"/"previous"
 * are each one week, but MoM/YoY compare whole months/years, so there's
 * nothing to break down week-by-week for those. The per-store-format
 * breakdown (the normal stacked view) is dropped in this mode.
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
  comparisonType = null,
  comparisonResult = null,
  comparisonLoading = false,
}) {
  const salesData = summaryByMode[mode]

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

      {comparisonActive ? (
        <>
          {comparisonLoading && <p className="text-deep-violet-blue/70 text-sm">Loading comparison...</p>}
          {!comparisonLoading && comparisonResult && (
            <div>
              <ComparisonTrend result={comparisonResult} comparisonType={comparisonType} />
              <p className="mt-1 text-right text-xs text-deep-violet-blue/60">
                Last Updated: {lastUpdated || "—"}
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          {loading && <p className="text-deep-violet-blue/70 text-sm">Loading dashboard...</p>}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          {!loading && !error && salesData && (
            <div>
              <RevenueTrend periodByFormat={salesData.periodByFormat} periodTotal={salesData.periodTotal} />
              <p className="mt-1 text-right text-xs text-deep-violet-blue/60">
                Last Updated: {lastUpdated || "—"}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Current-vs-previous total, shown while a Period Comparison is active.
// Each side is its own bar at its own x-axis category (see
// buildComparisonBars) rather than a grouped pair sharing one tick, so the
// label under each bar always describes that exact bar.
function ComparisonTrend({ result, comparisonType }) {
  const chartData = buildComparisonBars(result, comparisonType)

  return (
    <div>
      <ChartContainer config={comparisonChartConfig} className="h-[220px] w-full">
        <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" interval={0} tick={{ fontSize: 10 }} />
          <YAxis tickFormatter={formatAxisCurrency} width={50} tick={{ fontSize: 10 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {/* Each category only ever has one of current/previous set (the
              other is null) — without a shared stackId, Recharts still
              reserves a same-size side-by-side "slot" for both series in
              every category, so the one bar that actually has a value ends
              up drawn off to one side of its own tick instead of centered
              under it. Stacking two mutually-exclusive values just draws
              whichever one is non-null centered on its category, with no
              visual stacking effect since there's never more than one
              present at a time. */}
          <Bar
            dataKey="previous"
            stackId="comparison"
            fill="var(--color-previous)"
            radius={4}
            maxBarSize={MAX_BAR_SIZE}
            isAnimationActive={false}
          />
          <Bar
            dataKey="current"
            stackId="comparison"
            fill="var(--color-current)"
            radius={4}
            maxBarSize={MAX_BAR_SIZE}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      {/* Manual legend, not Recharts' <Legend> — a stacked BarChart's
          auto-generated legend order follows Recharts' own internal stack
          bookkeeping rather than <Bar> JSX order or an explicit payload
          override (both were tried and didn't change it), so there's no
          reliable way to make the built-in legend read left-to-right in
          the same previous-then-current order as the bars below it. */}
      <div className="flex items-center justify-center gap-4 pt-3 text-xs text-deep-violet-blue/70">
        <div className="flex items-center gap-1.5">
          <div
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: comparisonChartConfig.previous.color }}
          />
          Previous
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: comparisonChartConfig.current.color }}
          />
          Current
        </div>
      </div>
    </div>
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
