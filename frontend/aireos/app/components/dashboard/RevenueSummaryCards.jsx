"use client"

import { useState } from "react"
import FormatMixBar from "@/components/dashboard/FormatMixBar"
import { changePct, formatChangePct } from "@/app/utils/periodComparison"
import { FALLBACK_FORMAT_COLOR, FORMAT_COLORS } from "@/app/utils/storeFormats"

function sumFormats(storeFormats = []) {
  return storeFormats.reduce(
    (acc, format) => ({ revenue: acc.revenue + format.revenue, units: acc.units + format.units }),
    { revenue: 0, units: 0 }
  )
}

// "▲ +12.1%" under a card's figures; nothing without a comparison. What it's
// compared against is named once in the panel header, not on every card.
function CardChange({ current, baseline }) {
  if (baseline === null) return null
  const pct = changePct(current, baseline)
  const color = pct > 0 ? "text-green-600" : pct < 0 ? "text-red-600" : "text-deep-violet-blue/60"
  return (
    <span className={`shrink-0 text-xs font-medium tabular-nums ${color}`}>
      {pct > 0 ? "▲ " : pct < 0 ? "▼ " : ""}
      {formatChangePct(pct)}
    </span>
  )
}

// Compact two-line tile: format + share of total with the change on the
// first line, bold revenue with units on the second. No "Revenue:"/"Units:"
// labels — position and weight tell them apart. A plain bordered div
// rather than the Card primitive, whose header/content spacing made these
// tall. Lines wrap rather than clip if a tile gets very narrow.
function SummaryCard({
  title,
  totals,
  share = null,
  shareLabel = "",
  baselineRevenue,
  emphasis = false,
  color = null,
  highlighted = false,
  onHover = null,
  className = "",
}) {
  return (
    <div
      onMouseEnter={onHover ? () => onHover(title) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      // Highlight ring in the format's own mix-bar colour, so the tile and
      // its segment visibly belong together.
      style={highlighted && color ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
      className={`min-w-[8rem] rounded-lg bg-white px-2.5 py-1.5 text-deep-violet-blue transition-shadow ${
        emphasis ? "border-2 border-deep-violet-blue" : "border border-lavander"
      } ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="flex min-w-0 items-center gap-1 truncate text-xs font-medium">
          {color && (
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
          )}
          {title}
          {share !== null && (
            <span className="font-normal text-deep-violet-blue/60" title={shareLabel}>
              {" "}
              · {share > 0 && share < 1 ? "<1" : share.toFixed(0)}%
            </span>
          )}
        </p>
        <CardChange current={totals.revenue} baseline={baselineRevenue} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <p className="text-sm font-semibold tabular-nums">${totals.revenue.toLocaleString()}</p>
        <p className="text-xs text-deep-violet-blue/60 tabular-nums">{totals.units.toLocaleString()} units</p>
      </div>
    </div>
  )
}

// Revenue/units per store format, plus the Total. Reads from the same
// useDashboardSummary data as RevenueTrendCard (passed down from page.js)
// rather than fetching independently. One grid, Total first:
// - lg and up (where page.js gives this card the full page width): every
//   card in one row, however many formats the channel has (offline has 4,
//   online has 1) — grid-flow-col with equal auto columns.
// - sm–md: 3 columns (Total + 4 formats = 3 + 2).
// - phones: 2 columns with Total spanning the top row, so the 4 formats
//   sit 2 × 2 instead of leaving one orphan card at the bottom.
// Cards keep a min width so figures never clip. Above the tiles, the
// format mix bar shows each format's share of revenue or volume; the tiles'
// "59%" shares follow the same choice, and hovering a segment or a tile
// highlights its partner. Each format shows its share
// of total revenue and, with a "Compare to" baseline, its change vs the
// same format in the baseline.
export default function RevenueSummaryCards({
  summaryByMode = {},
  baselineSummaryByMode = null,
  compareShort = "",
  loading = false,
  error = null,
  mode = "offline",
}) {
  const [mixMetric, setMixMetric] = useState("revenue")
  const [hoveredFormat, setHoveredFormat] = useState(null)
  const salesData = summaryByMode[mode]
  const baselineData = baselineSummaryByMode?.[mode] ?? null
  const total = sumFormats(salesData?.storeFormats)
  const baselineRevenueByFormat = new Map(
    (baselineData?.storeFormats ?? []).map((format) => [format.format, format.revenue])
  )

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <p className="text-sm font-medium text-deep-violet-blue mb-2">
        Sell-out Summary
        {baselineData && compareShort && (
          <span className="font-normal text-deep-violet-blue/60"> · change {compareShort}</span>
        )}
      </p>

      {loading && <p className="text-deep-violet-blue/70 text-sm">Loading sell-out summary...</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {salesData && salesData.storeFormats.length > 1 && (
        <FormatMixBar
          formats={salesData.storeFormats}
          metric={mixMetric}
          onMetricChange={setMixMetric}
          highlighted={hoveredFormat}
          onHover={setHoveredFormat}
        />
      )}

      {salesData && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-flow-col lg:grid-cols-none lg:auto-cols-[minmax(0,1fr)]">
          <SummaryCard
            title="Total"
            totals={total}
            baselineRevenue={baselineData ? sumFormats(baselineData.storeFormats).revenue : null}
            emphasis
            className="col-span-2 sm:col-span-1"
          />
          {salesData.storeFormats.map((format) => (
            <SummaryCard
              key={format.format}
              title={format.format}
              totals={format}
              share={total[mixMetric] ? (format[mixMetric] / total[mixMetric]) * 100 : null}
              shareLabel={mixMetric === "units" ? "Share of total volume" : "Share of total revenue"}
              color={FORMAT_COLORS[format.format] ?? FALLBACK_FORMAT_COLOR}
              highlighted={hoveredFormat === format.format}
              onHover={setHoveredFormat}
              baselineRevenue={baselineData ? (baselineRevenueByFormat.get(format.format) ?? 0) : null}
            />
          ))}
        </div>
      )}
    </div>
  )
}
