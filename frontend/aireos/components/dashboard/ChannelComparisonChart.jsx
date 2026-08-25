"use client"

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

// Maps each data series to a label + a CSS var color so it auto-adapts
// to the Tailwind light/dark theme.
const chartConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
}

/**
 * Renders the per-channel revenue comparison. Takes the "channels" array
 * straight from the API contract (see lib/types/sales.js) — no grouping
 * or summing happens here.
 *
 * @param {{ data: import("@/lib/types/sales").ChannelSummary[] }} props
 */
export function ChannelComparisonChart({ data }) {
  return (
    // min-h is required for Recharts' ResponsiveContainer to size correctly
    <ChartContainer config={chartConfig} className="h-[400px] w-full">
      <BarChart accessibilityLayer data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="retailer" />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
