"use client"

import ChartLoading from "@/components/ui/ChartLoading"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import ComparisonMixChart from "@/components/dashboard/ComparisonMixChart"
import { FormatTrendChart } from "@/components/dashboard/TrendChart"
import { formatDateTime } from "@/lib/formatDate"

const tabTriggerClass =
  "text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:text-white"

/**
 * Revenue trend card: offline/online mode switch, an optional `headerExtra`
 * slot beside it (page.js puts the Period and Compare to controls there, so
 * the timeframe is read before the chart), a By week / By month switch, and
 * the revenue chart. Data comes from the shared useDashboardSummary hook
 * (called in page.js) so this and RevenueSummaryCards don't each fetch the
 * same data independently.
 *
 * The chart is always stacked by store format, in the format colours, so a
 * colour always means one format: FormatTrendChart with no comparison, and
 * ComparisonMixChart with one, where solid vs hatched (the comparison is
 * always hatched) separates this period from the comparison. A single-format channel (online) is one stack in
 * that format's colour.
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
  weeklyGap = null,
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
        {/* weeklyGap (weeklyGapMessage) names at most a few month ranges;
            its hover text lists them all. */}
        <p className="text-xs text-deep-violet-blue/60" title={weeklyGap?.detail}>
          {(refreshing || freshnessRefreshing) ? "Refreshing latest data…" : (weeklyGap?.text ?? "")}
        </p>
        <div className="flex items-center gap-2">
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

      {/* Always the full placeholder, never the overlay: a refetch can change
          the granularity or add a comparison, and the old bars would be
          drawn with the new labels. flex-1 keeps the card's height. */}
      {busy && <ChartLoading label="Loading dashboard…" className="flex-1" />}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!busy && !error && salesData && (
        <div className="flex flex-1 flex-col">
          {comparisonRows ? (
            <ComparisonMixChart rows={comparisonRows} periodNames={periodNames} granularity={granularity} />
          ) : (
            <FormatTrendChart
              periodByFormat={salesData.periodByFormat}
              periodTotal={salesData.periodTotal}
              granularity={granularity}
            />
          )}
          <p className="mt-1 text-right text-xs text-deep-violet-blue/60">
            Last Updated: {formatDateTime(lastUpdated)}
          </p>
        </div>
      )}
    </div>
  )
}
