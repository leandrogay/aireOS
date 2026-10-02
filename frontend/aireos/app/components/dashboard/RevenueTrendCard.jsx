"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import ComparisonMixChart from "@/components/dashboard/ComparisonMixChart"
import ComparisonTotalChart from "@/components/dashboard/ComparisonTotalChart"
import { FormatTrendChart, TotalTrendChart } from "@/components/dashboard/TrendChart"
import { formatDateTime } from "@/lib/formatDate"
import { singleFormatColor } from "@/app/utils/storeFormats"

const tabTriggerClass =
  "text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:text-white"

// Same sizing as the chart so the card doesn't jump when loading gives way
// to it.
function ChartLoading({ label }) {
  return (
    <div className="flex min-h-[220px] w-full flex-1 flex-col items-center justify-center gap-2 text-deep-violet-blue/60">
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
 * With no comparison the chart is stacked by store format, in the format
 * colours (FormatTrendChart) — or plain neutral bars (TotalTrendChart) for
 * a single-format channel (online), which has no breakdown to show and so
 * takes that format's colour (FPON) instead of the neutral one.
 *
 * With a comparison, a Total / By format switch (when the channel has more
 * than one format) picks the colour logic, kept strict so a colour always
 * means one thing:
 * - Total (default): neutral period colours only — solid this period,
 *   hatched comparison — never a format colour (ComparisonTotalChart).
 * - By format: stacks in the format colours, solid vs hatched separating the
 *   periods (ComparisonMixChart).
 * With a comparison, `comparisonRows` comes pre-aligned from
 * alignComparisonBuckets, so the charts only render.
 */
export default function RevenueTrendCard({
  summaryByMode = {},
  loading = false,
  refreshing = false,
  error = null,
  freshnessRefreshing = false,
  lastUpdated = null,
  weeklyBreakdownUnavailable = false,
  unavailableMonthLabel = "",
  mode = "offline",
  onModeChange = () => {},
  headerExtra = null,
  granularity = "week",
  onGranularityChange = () => {},
  comparisonRows = null,
  comparisonLoading = false,
  periodNames = null,
}) {
  const [chartView, setChartView] = useState("total")
  const salesData = summaryByMode[mode]
  const busy = loading || (comparisonRows !== null && comparisonLoading)
  // Online has a single format, where "By format" would just repeat Total.
  const formats = (salesData?.periodByFormat ?? []).map((row) => row.format)
  const hasFormatMix = new Set(formats).size > 1
  const channelColor = singleFormatColor(formats)
  const showViewSwitch = comparisonRows !== null && hasFormatMix

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full flex flex-col">
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
          {(refreshing || freshnessRefreshing)
            ? "Refreshing latest data…"
            : weeklyBreakdownUnavailable
            ? `Weekly breakdown unavailable for ${unavailableMonthLabel || "this period"}. Monthly sales data is available.`
            : ""}
        </p>
        <div className="flex items-center gap-2">
          {showViewSwitch && (
            <Tabs value={chartView} onValueChange={setChartView}>
              <TabsList className="h-7 bg-lavander">
                <TabsTrigger value="total" className={`text-xs ${tabTriggerClass}`}>
                  Total
                </TabsTrigger>
                <TabsTrigger value="format" className={`text-xs ${tabTriggerClass}`}>
                  By format
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
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
      </div>

      {busy && <ChartLoading label="Loading dashboard..." />}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!busy && !error && salesData && (
        <div className="flex flex-1 flex-col">
          {comparisonRows && showViewSwitch && chartView === "format" ? (
            <ComparisonMixChart rows={comparisonRows} periodNames={periodNames} granularity={granularity} />
          ) : comparisonRows ? (
            <ComparisonTotalChart
              rows={comparisonRows}
              periodNames={periodNames}
              granularity={granularity}
              color={channelColor}
            />
          ) : hasFormatMix ? (
            <FormatTrendChart
              periodByFormat={salesData.periodByFormat}
              periodTotal={salesData.periodTotal}
              granularity={granularity}
            />
          ) : (
            <TotalTrendChart periodTotal={salesData.periodTotal} granularity={granularity} color={channelColor} />
          )}
          <p className="mt-1 text-right text-xs text-deep-violet-blue/60">
            Last Updated: {formatDateTime(lastUpdated)}
          </p>
        </div>
      )}
    </div>
  )
}
