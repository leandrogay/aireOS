"use client"

import BarChartSkeleton from "@/components/ui/BarChartSkeleton"
import ChartCard from "@/components/ui/ChartCard"
import { CHART_FRAME_CLASS } from "@/components/ui/ChartFrame"
import { Skeleton } from "@/components/ui/skeleton"
import SegmentedControl from "@/components/ui/SegmentedControl"
import ComparisonMixChart from "@/components/dashboard/ComparisonMixChart"
import CustomerTrendChart from "@/components/dashboard/CustomerTrendChart"
import { FormatTrendChart } from "@/components/dashboard/TrendChart"
import { formatDateTime } from "@/lib/formatDate"
import { relabelFormatRows } from "@/app/utils/storeFormats"
import useDelayedLoading from "@/hooks/useDelayedLoading"
import { cn } from "@/lib/utils"

const METRIC_OPTIONS = [
  { value: "units", label: "Volume" },
  { value: "revenue", label: "Revenue" },
]

// Under the chart, on the right: when the data was last updated. Estimated
// revenue is shown per bar in the chart's tooltip, not here.
function ChartFooter({ lastUpdated }) {
  return (
    <p className="mt-1 text-right text-xs text-deep-violet-blue/60">Last Updated: {formatDateTime(lastUpdated)}</p>
  )
}

/**
 * Revenue trend card: a top row with an optional `headerExtra` on the left
 * (page.js puts the Period and Compare to controls there, so the timeframe is
 * read before the chart) and `channelSwitch` (Offline / Online, ChannelSwitch)
 * in the top right corner; then, on the right, the view
 * switches Volume / Revenue (`metric`, owned by page.js because the comparison
 * rows are built for it) and By week / By month; then the chart.
 *
 * The chart is always stacked by store format, each a shade of the
 * customer's colour (`formatColor`, from page.js, shared with the summary
 * tiles), so a shade always means one format: FormatTrendChart with no comparison, and
 * ComparisonMixChart with one, where solid vs hatched (the comparison is
 * always hatched) separates this period from the comparison. A single-format channel (online) is one stack in
 * the customer's colour.
 * With a comparison, `comparisonRows` comes pre-aligned from
 * alignComparisonBuckets, so the charts only render.
 * With two or more customers ticked, `customerBars` (get_customer_trends rows)
 * draws CustomerTrendChart instead: each customer per week or month.
 * A bar's tooltip says how much of its revenue is estimated.
 */
export default function RevenueTrendCard({
  summaryByMode = {},
  loading = false,
  refreshing = false,
  error = null,
  freshnessRefreshing = false,
  lastUpdated = null,
  weeklyGap = null,
  weekAvailable = true,
  mode = "offline",
  headerExtra = null,
  channelSwitch = null,
  granularity = "week",
  onGranularityChange = () => {},
  comparisonRows = null,
  comparisonLoading = false,
  periodNames = null,
  customerBars = null,
  customerPalette,
  formatColor,
  metric = "revenue",
  onMetricChange = () => {},
}) {
  const salesData = summaryByMode[mode]
  const comparingCustomers = customerBars !== null
  // A fast load skips the placeholder instead of flashing it (useDelayedLoading).
  const { pending: busy, placeholderClass } = useDelayedLoading({
    loading: loading || (!comparingCustomers && comparisonRows !== null && comparisonLoading),
  })

  return (
    // No ChartCard header: the two control rows below keep their order (what
    // data, then how to draw it, just above the chart). `fill`: as tall as the
    // Comparison card beside it, the chart taking the rest (ChartFrame fill).
    <ChartCard label="Sales trend" fill>
      {/* Top row: what data (Period, Compare to) on the left, lined up on
          their bottom edge, and which channel in the card's top right corner
          (self-start), level with the "Period" label. On a phone the channel
          wraps under Compare to and lines up on the left with the other
          controls; from sm up it sits on the right (sm:ml-auto). */}
      <div className="mb-2 flex flex-wrap items-end gap-x-3 gap-y-2">
        {headerExtra}
        {channelSwitch && <div className="mt-1 self-start sm:ml-auto">{channelSwitch}</div>}
      </div>

      {/* How to draw it: the view switches on their own line, on the right,
          just above the chart they change. */}
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
        <SegmentedControl look="glass" value={metric} onChange={onMetricChange} options={METRIC_OPTIONS} ariaLabel="Metric" />
        {/* By week is disabled (faded) when no month in the range has weekly
            rows (page.js weekAvailable). */}
        {/* 152px, as wide as the Offline / Online switch above it
            (ChannelSwitch), so the two line up on both edges; wide enough
            for "By month" in an equal half. */}
        <SegmentedControl
          look="glass"
          fullWidth
          className="w-[152px]"
          value={granularity}
          onChange={onGranularityChange}
          options={[
            { value: "week", label: "By week", disabled: !weekAvailable },
            { value: "month", label: "By month" },
          ]}
          ariaLabel="Group by"
        />
      </div>

      {/* Only when there is something to say. weeklyGap (weeklyGapMessage)
          names at most a few month ranges; its hover text lists them all. */}
      {(refreshing || freshnessRefreshing || weeklyGap?.text) && (
        <p className="mb-1 text-xs text-deep-violet-blue/60" title={weeklyGap?.detail}>
          {(refreshing || freshnessRefreshing) ? "Refreshing latest data…" : weeklyGap.text}
        </p>
      )}

      {/* Always the full placeholder, never the overlay: a refetch can change
          the granularity or add a comparison, and the old bars would be
          drawn with the new labels. flex-1 keeps the card's height. */}
      {busy && (
        // Same box as the loaded state: a flex-1 chart (min 220px) plus the footer line, so the card
        // keeps its height when the data arrives. The usual state is a few customers ticked, one month
        // (CustomerTrendChart: one cluster of a bar per customer); otherwise a year of months by ~4 formats.
        <div className={`flex flex-1 flex-col ${placeholderClass}`}>
          <BarChartSkeleton
            bars={comparingCustomers ? 6 : 12}
            groups={comparingCustomers ? 1 : 1}
            height={220}
            fill
            legend
            legendItems={comparingCustomers ? 3 : 4}
            label="Loading dashboard…"
            className={cn(CHART_FRAME_CLASS, "flex-1")}
          />
          <div className="mt-1 flex items-baseline justify-end">
            <Skeleton className="h-4 w-40 rounded bg-lavander motion-reduce:animate-none" />
          </div>
        </div>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!busy && !error && comparingCustomers && (
        <div className="flex flex-1 flex-col">
          <CustomerTrendChart customers={customerBars} mode={mode} metric={metric} granularity={granularity} palette={customerPalette} />
          <ChartFooter lastUpdated={lastUpdated} />
        </div>
      )}
      {!busy && !error && !comparingCustomers && salesData && (
        <div className="flex flex-1 flex-col">
          {comparisonRows ? (
            <ComparisonMixChart
              rows={comparisonRows}
              periodNames={periodNames}
              granularity={granularity}
              metric={metric}
              colorFor={formatColor}
            />
          ) : (
            <FormatTrendChart
              periodByFormat={relabelFormatRows(salesData.periodByFormat ?? [])}
              periodTotal={salesData.periodTotal}
              granularity={granularity}
              metric={metric}
              colorFor={formatColor}
            />
          )}
          <ChartFooter lastUpdated={lastUpdated} />
        </div>
      )}
    </ChartCard>
  )
}
