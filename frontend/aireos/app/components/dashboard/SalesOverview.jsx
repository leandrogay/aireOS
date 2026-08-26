"use client"

import { useEffect, useState } from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from "recharts"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"

// AIRE palette assigned per store format. Reused across offline (4 series)
// and online (1 series) since only one mode's chart is ever on screen at once.
const FORMAT_COLORS = {
  HYPER: "var(--aire-deep-blue)",
  SUPER: "var(--aire-violet)",
  FINEST: "var(--aire-celest)",
  UNITY: "var(--aire-lavender)",
  FPON: "var(--aire-cream)",
}

const fallbackChartConfig = {
  revenue: { label: "Revenue", color: "var(--aire-deep-blue)" },
}

// Reshapes the flat [{ period_label, format, revenue }] rows the API returns
// into one row per period with a column per format, which is the shape
// Recharts needs for a stacked bar. Pure reshape — no sums/percentages.
function pivotByFormat(periodByFormat) {
  const byPeriod = new Map()
  for (const row of periodByFormat) {
    if (!byPeriod.has(row.period_label)) {
      byPeriod.set(row.period_label, { period_label: row.period_label })
    }
    byPeriod.get(row.period_label)[row.format] = row.revenue
  }
  return [...byPeriod.values()]
}

const GRANULARITIES = ["week", "month"]

const MONTH_ABBR = {
  January: "Jan",
  February: "Feb",
  March: "Mar",
  April: "Apr",
  May: "May",
  June: "Jun",
  July: "Jul",
  August: "Aug",
  September: "Sep",
  October: "Oct",
  November: "Nov",
  December: "Dec",
}

// Custom XAxis tick so every bar gets a label instead of Recharts' default
// auto-thinning (which skips ticks unevenly to fit the width). Monthly
// period_labels ("October 2024") render as two lines — abbreviated month
// over year; anything else (e.g. weekly "Week 32" labels) renders as-is.
function PeriodAxisTick({ x, y, payload }) {
  const match = /^([A-Za-z]+) (\d{4})$/.exec(payload.value)
  if (!match) {
    return (
      <text x={x} y={y} dy={12} textAnchor="middle" fontSize={12}>
        {payload.value}
      </text>
    )
  }
  const [, month, year] = match
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={12}>
      <tspan x={x} dy={12}>{MONTH_ABBR[month] ?? month.slice(0, 3)}</tspan>
      <tspan x={x} dy={14}>{year}</tspan>
    </text>
  )
}

/**
 * Cross-channel sales overview for AO2-1: offline/online mode switch,
 * weekly/monthly granularity switch, one revenue/units card per store
 * format, and the revenue trend chart.
 *
 * Self-contained like SkuRanking below it on the page — but unlike it, both
 * granularities are fetched once, in parallel, on mount (each is its own
 * BigQuery aggregation, ~2-3s per call, and that cost is fixed regardless of
 * data size — see backend/app/services/bigquery.py). Both `mode` and
 * `granularity` then just re-slice the already-fetched cache client-side, so
 * toggling either one afterward is instant with no refetch.
 *
 * Auto-refresh: parent polls /last-updated and bumps `dataVersion` when a
 * retailer's loaded_at changes; we refetch both summary granularities then.
 */
export default function SalesOverview({
  lastUpdatedByMode = {},
  dataVersion = 0,
  freshnessRefreshing = false,
}) {
  const [mode, setMode] = useState("offline")
  const [granularity, setGranularity] = useState("week")
  const [summaryByGranularity, setSummaryByGranularity] = useState({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function fetchSummary(g) {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/sales/dashboard-summary?granularity=${g}`
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "Failed to load dashboard summary")
      return [g, data]
    }

    async function loadSummaries() {
      try {
        if (dataVersion === 0) {
          setLoading(true)
        } else {
          setRefreshing(true)
        }

        const entries = await Promise.all(GRANULARITIES.map(fetchSummary))
        if (cancelled) return

        setSummaryByGranularity(Object.fromEntries(entries))
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    loadSummaries()
    return () => {
      cancelled = true
    }
  }, [dataVersion])

  const salesData = summaryByGranularity[granularity]?.[mode]
  const lastUpdated = lastUpdatedByMode[mode]?.lastUpdated

  return (
    <div className="space-y-6 mb-8">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={mode} onValueChange={setMode}>
          <TabsList>
            <TabsTrigger value="offline">Offline</TabsTrigger>
            <TabsTrigger value="online">Online</TabsTrigger>
          </TabsList>
        </Tabs>

        <Tabs value={granularity} onValueChange={setGranularity}>
          <TabsList>
            <TabsTrigger value="week">Weekly</TabsTrigger>
            <TabsTrigger value="month">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>

        {(refreshing || freshnessRefreshing) && (
          <p className="text-xs text-muted-foreground">Refreshing latest data…</p>
        )}
      </div>

      {loading && <p className="text-gray-500 text-sm">Loading dashboard...</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {salesData && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {salesData.storeFormats.map((format) => (
              <Card key={format.format}>
                <CardHeader>
                  <CardTitle>{format.format}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div>Revenue: ${format.revenue.toLocaleString()}</div>
                  <div>Units: {format.units.toLocaleString()}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div>
            <RevenueTrend
              periodByFormat={salesData.periodByFormat}
              periodTotal={salesData.periodTotal}
              granularity={granularity}
            />
            <p className="mt-2 text-right text-xs text-muted-foreground">
              Last Updated: {lastUpdated || "—"}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// FALLBACK: renders a single-series line while periodByFormat is empty (e.g.
// online mode currently has no per-format breakdown), otherwise the real
// stacked-bar-per-format view.
//
// Every bar gets a label only for monthly granularity — there are only ~12-24
// of them, so a two-line "Mon / YYYY" tick per bar stays readable. Weekly has
// far more bars, so it keeps Recharts' default auto-thinned single-line ticks.
function RevenueTrend({ periodByFormat, periodTotal, granularity }) {
  const monthlyAxisProps =
    granularity === "month"
      ? { interval: 0, height: 44, tick: <PeriodAxisTick /> }
      : {}

  if (periodByFormat.length === 0) {
    return (
      <ChartContainer config={fallbackChartConfig} className="h-[400px] w-full">
        <LineChart accessibilityLayer data={periodTotal} margin={{ bottom: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="period_label" {...monthlyAxisProps} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line
            dataKey="revenue"
            stroke="var(--color-revenue)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartContainer>
    )
  }

  const formats = [...new Set(periodByFormat.map((row) => row.format))]
  const chartConfig = Object.fromEntries(
    formats.map((format) => [format, { label: format, color: FORMAT_COLORS[format] }])
  )
  const chartData = pivotByFormat(periodByFormat)

  return (
    <ChartContainer config={chartConfig} className="h-[400px] w-full">
      <BarChart accessibilityLayer data={chartData} margin={{ bottom: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="period_label" {...monthlyAxisProps} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {formats.map((format) => (
          <Bar
            key={format}
            dataKey={format}
            stackId="format"
            fill={`var(--color-${format})`}
            radius={4}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
