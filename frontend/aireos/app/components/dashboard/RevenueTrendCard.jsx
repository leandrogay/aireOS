"use client"

import BarChartSkeleton from "@/components/ui/BarChartSkeleton"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import ComparisonMixChart from "@/components/dashboard/ComparisonMixChart"
import CustomerTrendChart from "@/components/dashboard/CustomerTrendChart"
import EstMark from "@/components/dashboard/EstMark"
import { FormatTrendChart } from "@/components/dashboard/TrendChart"
import { formatDateTime } from "@/lib/formatDate"
import { relabelFormatRows } from "@/app/utils/storeFormats"

const tabTriggerClass =
  "text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:text-white"

// Under the chart: EST on the left when it includes estimated revenue, and
// when the data was last updated on the right, on one text line (baseline).
function ChartFooter({ estimate, lastUpdated }) {
  return (
    <div className="mt-1 flex items-baseline justify-between gap-2">
      <span>{estimate && <EstMark estimated={estimate.estimated} total={estimate.total} className="text-xs" />}</span>
      <p className="text-xs text-deep-violet-blue/60">Last Updated: {formatDateTime(lastUpdated)}</p>
    </div>
  )
}

/**
 * Revenue trend card: one control row -- an optional `headerExtra` on the left
 * (page.js puts the Period and Compare to controls there, so the timeframe is
 * read before the chart) and same-size switches on the right, Volume / Revenue
 * (`metric`, owned by page.js because the comparison rows are built for it)
 * and By week / By month -- then the chart. Offline / Online (`mode`) is chosen
 * beside the page title (ChannelSwitch), since it changes the whole page.
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
 * `estimate` ({ estimated, total }, from page.js) puts one EST under the
 * chart when anything it draws includes estimated revenue, however many bars
 * do; hovering it says how much, and a bar's tooltip gives its own share.
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
  granularity = "week",
  onGranularityChange = () => {},
  comparisonRows = null,
  comparisonLoading = false,
  periodNames = null,
  customerBars = null,
  customerColorOrder = [],
  estimate = null,
  metric = "revenue",
  onMetricChange = () => {},
}) {
  // Units are always reported, so EST only ever applies to the Revenue view.
  const shownEstimate = metric === "revenue" ? estimate : null
  const salesData = summaryByMode[mode]
  const comparingCustomers = customerBars !== null
  const busy = loading || (!comparingCustomers && comparisonRows !== null && comparisonLoading)

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full flex flex-col">
      {/* One row: the period controls on the left, the view switches on the
          right, lined up on their bottom edge. On a narrow card the switches
          wrap to their own line, still on the right (ml-auto), and on a very
          narrow one onto a line each. */}
      <div className="mb-2 flex flex-wrap items-end gap-x-3 gap-y-2">
        {headerExtra}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Tabs value={metric} onValueChange={onMetricChange}>
            <TabsList className="h-7 bg-lavander">
              <TabsTrigger value="units" className={`text-xs ${tabTriggerClass}`}>
                Volume
              </TabsTrigger>
              <TabsTrigger value="revenue" className={`text-xs ${tabTriggerClass}`}>
                Revenue
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={granularity} onValueChange={onGranularityChange}>
            <TabsList className="h-7 bg-lavander">
              {/* Disabled (faded) when no month in the range has weekly rows
                  (page.js weekAvailable). */}
              <TabsTrigger value="week" disabled={!weekAvailable} className={`text-xs ${tabTriggerClass}`}>
                By week
              </TabsTrigger>
              <TabsTrigger value="month" className={`text-xs ${tabTriggerClass}`}>
                By month
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
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
          <ChartFooter estimate={shownEstimate} lastUpdated={lastUpdated} />
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
          <ChartFooter estimate={shownEstimate} lastUpdated={lastUpdated} />
        </div>
      )}
    </div>
  )
}
