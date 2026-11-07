"use client"

import BarChartSkeleton from "@/components/ui/BarChartSkeleton"
import { Skeleton } from "@/components/ui/skeleton"
import SegmentedControl from "@/components/ui/SegmentedControl"
import ComparisonMixChart from "@/components/dashboard/ComparisonMixChart"
import CustomerTrendChart from "@/components/dashboard/CustomerTrendChart"
import { FormatTrendChart } from "@/components/dashboard/TrendChart"
import { formatDateTime } from "@/lib/formatDate"
import { relabelFormatRows } from "@/app/utils/storeFormats"

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
 * The chart is always stacked by store format, in the format colours, so a
 * colour always means one format: FormatTrendChart with no comparison, and
 * ComparisonMixChart with one, where solid vs hatched (the comparison is
 * always hatched) separates this period from the comparison. A single-format channel (online) is one stack in
 * that format's colour.
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
  customerColorOrder = [],
  metric = "revenue",
  onMetricChange = () => {},
}) {
  const salesData = summaryByMode[mode]
  const comparingCustomers = customerBars !== null
  const busy = loading || (!comparingCustomers && comparisonRows !== null && comparisonLoading)

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full flex flex-col">
      {/* Top row: what data (Period, Compare to) on the left, lined up on
          their bottom edge, and which channel in the card's top right corner
          (self-start), level with the "Period" label. On a narrow card the
          channel wraps under the period, still on the right (ml-auto). */}
      <div className="mb-2 flex flex-wrap items-end gap-x-3 gap-y-2">
        {headerExtra}
        {channelSwitch && <div className="ml-auto mt-1 self-start">{channelSwitch}</div>}
      </div>

      {/* How to draw it: the view switches on their own line, on the right,
          just above the chart they change. */}
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
        <SegmentedControl value={metric} onChange={onMetricChange} options={METRIC_OPTIONS} ariaLabel="Metric" />
        {/* By week is disabled (faded) when no month in the range has weekly
            rows (page.js weekAvailable). */}
        <SegmentedControl
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
        <div className="flex flex-1 flex-col">
          <BarChartSkeleton
            bars={comparingCustomers ? 1 : 12}
            groups={comparingCustomers ? 3 : 1}
            height={220}
            fill
            legend
            legendItems={comparingCustomers ? 3 : 4}
            label="Loading dashboard…"
            className="flex-1"
          />
          <div className="mt-1 flex items-baseline justify-end">
            <Skeleton className="h-4 w-40 rounded bg-lavander motion-reduce:animate-none" />
          </div>
        </div>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!busy && !error && comparingCustomers && (
        <div className="flex flex-1 flex-col">
          <CustomerTrendChart customers={customerBars} mode={mode} metric={metric} granularity={granularity} colorOrder={customerColorOrder} />
          <ChartFooter lastUpdated={lastUpdated} />
        </div>
      )}
      {!busy && !error && !comparingCustomers && salesData && (
        <div className="flex flex-1 flex-col">
          {comparisonRows ? (
            <ComparisonMixChart rows={comparisonRows} periodNames={periodNames} granularity={granularity} metric={metric} />
          ) : (
            <FormatTrendChart
              periodByFormat={relabelFormatRows(salesData.periodByFormat ?? [])}
              periodTotal={salesData.periodTotal}
              granularity={granularity}
              metric={metric}
            />
          )}
          <ChartFooter lastUpdated={lastUpdated} />
        </div>
      )}
    </div>
  )
}
