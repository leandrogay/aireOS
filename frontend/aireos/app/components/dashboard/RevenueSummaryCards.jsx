"use client"

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { changePct, formatChangePct } from "@/app/utils/periodComparison"

function sumFormats(storeFormats = []) {
  return storeFormats.reduce(
    (acc, format) => ({ revenue: acc.revenue + format.revenue, units: acc.units + format.units }),
    { revenue: 0, units: 0 }
  )
}

// "▲ +12.1% vs last year" under a card's figures; nothing without a comparison.
function CardChange({ current, baseline, compareShort }) {
  if (baseline === null) return null
  const pct = changePct(current, baseline)
  const color = pct > 0 ? "text-green-600" : pct < 0 ? "text-red-600" : "text-deep-violet-blue/60"
  return (
    <div className={`text-xs font-medium ${color}`}>
      {pct > 0 ? "▲ " : pct < 0 ? "▼ " : ""}
      {formatChangePct(pct)} {compareShort}
    </div>
  )
}

// Per-store-format revenue/units cards, split out of the old combined
// SalesOverview so it can sit in its own grid cell. Reads from the same
// useDashboardSummary data as RevenueTrendCard (passed down from page.js)
// rather than fetching independently. With a "Compare to" baseline, each
// card also shows its revenue change vs the same format in the baseline.
export default function RevenueSummaryCards({
  summaryByMode = {},
  baselineSummaryByMode = null,
  compareShort = "",
  loading = false,
  error = null,
  mode = "offline",
}) {
  const salesData = summaryByMode[mode]
  const baselineData = baselineSummaryByMode?.[mode] ?? null
  const total = sumFormats(salesData?.storeFormats)
  const baselineRevenueByFormat = new Map(
    (baselineData?.storeFormats ?? []).map((format) => [format.format, format.revenue])
  )

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <p className="text-sm font-medium text-deep-violet-blue mb-2">Revenue Summary</p>

      {loading && <p className="text-deep-violet-blue/70 text-sm">Loading revenue summary...</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {salesData && (
        <div className="grid grid-flow-col auto-cols-fr gap-2">
          <Card size="sm" className="ring-lavander border-2 border-deep-violet-blue text-deep-violet-blue">
            <CardHeader>
              <CardTitle>Total</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              <div>Revenue: ${total.revenue.toLocaleString()}</div>
              <div>Units: {total.units.toLocaleString()}</div>
              <CardChange
                current={total.revenue}
                baseline={baselineData ? sumFormats(baselineData.storeFormats).revenue : null}
                compareShort={compareShort}
              />
            </CardContent>
          </Card>
          {salesData.storeFormats.map((format) => (
            <Card key={format.format} size="sm" className="ring-lavander text-deep-violet-blue">
              <CardHeader>
                <CardTitle>{format.format}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-0.5">
                <div>Revenue: ${format.revenue.toLocaleString()}</div>
                <div>Units: {format.units.toLocaleString()}</div>
                <CardChange
                  current={format.revenue}
                  baseline={baselineData ? (baselineRevenueByFormat.get(format.format) ?? 0) : null}
                  compareShort={compareShort}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
