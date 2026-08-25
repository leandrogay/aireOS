import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

/**
 * Renders one card per store format. Takes the "storeFormats" array straight
 * from the API contract (see lib/types/sales.js) — no math happens here,
 * only display formatting (toLocaleString).
 *
 * % of total is intentionally not shown: the mock data has no pct_of_total
 * field for storeFormats, and that percentage isn't computed client-side.
 *
 * @param {{ storeFormats: import("@/lib/types/sales").StoreFormatSummary[] }} props
 */
export function StoreFormatCards({ storeFormats }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {storeFormats.map((format) => (
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
  )
}
