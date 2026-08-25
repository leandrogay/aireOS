import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

/**
 * Renders the overall sales summary. All numbers arrive pre-aggregated
 * from the API contract (see lib/types/sales.js) — no math happens here,
 * only display formatting (toLocaleString/toLocaleDateString).
 *
 * @param {{ summary: import("@/lib/types/sales").DashboardSummaryTotals }} props
 */
export function SummaryCard({ summary }) {
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Overall Sales Summary</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div>Units Sold: {summary.total_units.toLocaleString()}</div>
        <div>Revenue: ${summary.total_revenue.toLocaleString()}</div>
        <div className="col-span-2 text-sm text-muted-foreground">
          Last Updated: {new Date(summary.last_updated).toLocaleDateString()}
        </div>
      </CardContent>
    </Card>
  )
}
