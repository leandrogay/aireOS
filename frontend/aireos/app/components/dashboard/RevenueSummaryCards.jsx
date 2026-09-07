"use client"

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

// Per-store-format revenue/units cards, split out of the old combined
// SalesOverview so it can sit in its own grid cell. Reads from the same
// useDashboardSummary data as RevenueTrendCard (passed down from page.js)
// rather than fetching independently.
export default function RevenueSummaryCards({
  summaryByMode = {},
  loading = false,
  error = null,
  mode = "offline",
}) {
  const salesData = summaryByMode[mode]
  const total = salesData?.storeFormats.reduce(
    (acc, format) => ({ revenue: acc.revenue + format.revenue, units: acc.units + format.units }),
    { revenue: 0, units: 0 }
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
