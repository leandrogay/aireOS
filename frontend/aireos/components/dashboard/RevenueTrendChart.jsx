"use client"

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from "recharts"
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
function pivotByFormat(weeklyByFormat) {
  const byPeriod = new Map()
  for (const row of weeklyByFormat) {
    if (!byPeriod.has(row.period_label)) {
      byPeriod.set(row.period_label, { period_label: row.period_label })
    }
    byPeriod.get(row.period_label)[row.format] = row.revenue
  }
  return [...byPeriod.values()]
}

/**
 * Renders weekly revenue over time, broken down by store format. Takes
 * weeklyByFormat/weeklyTotal straight from the API contract (see
 * lib/types/sales.js) — no aggregation happens here, only reshaping/rendering.
 *
 * FALLBACK: real per-week-per-format figures haven't been pulled from
 * BigQuery yet, so weeklyByFormat is currently always []. Until it's
 * populated, this always falls back to the single-series weeklyTotal line
 * below — that fallback is temporary, not the intended final chart.
 *
 * @param {{
 *   weeklyByFormat: import("@/lib/types/sales").WeeklyByFormatPoint[],
 *   weeklyTotal: import("@/lib/types/sales").WeeklyTotalPoint[],
 * }} props
 */
export function RevenueTrendChart({ weeklyByFormat, weeklyTotal }) {
  if (weeklyByFormat.length === 0) {
    return (
      <ChartContainer config={fallbackChartConfig} className="h-[400px] w-full">
        <LineChart accessibilityLayer data={weeklyTotal}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="period_label" />
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

  const formats = [...new Set(weeklyByFormat.map((row) => row.format))]
  const chartConfig = Object.fromEntries(
    formats.map((format) => [format, { label: format, color: FORMAT_COLORS[format] }])
  )
  const chartData = pivotByFormat(weeklyByFormat)

  return (
    <ChartContainer config={chartConfig} className="h-[400px] w-full">
      <BarChart accessibilityLayer data={chartData}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="period_label" />
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
