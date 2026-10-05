"use client"

import { useState } from "react"
import FormatMixBar from "@/components/dashboard/FormatMixBar"
import { Skeleton } from "@/components/ui/skeleton"
import { changePct, formatChangePct } from "@/app/utils/periodComparison"
import { formatColor } from "@/app/utils/storeFormats"
import { PeriodSwatch, hatchTint } from "@/components/dashboard/PeriodTexture"

const TILE_GRID_CLASS =
  "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-flow-col lg:grid-cols-none lg:auto-cols-[minmax(0,1fr)]"

function sumFormats(storeFormats = []) {
  return storeFormats.reduce(
    (acc, format) => ({ revenue: acc.revenue + format.revenue, units: acc.units + format.units }),
    { revenue: 0, units: 0 }
  )
}

// "▲ +12.1%" on a card's top line; nothing without a comparison. What it's
// compared against shows on the card itself: the hatched line underneath
// (named on hover) and the comparison bar in the mix above. When either
// side has no data (or the comparison is zero) it reads a muted "N/A" with
// no arrow, rather than a red -100% for an empty period.
function CardChange({ current, baseline, available = true }) {
  if (baseline === null) return null
  const pct = available ? changePct(current, baseline) : null
  if (pct === null) {
    return (
      <span className="shrink-0 text-xs font-medium text-deep-violet-blue/40" title="Data not available">
        N/A
      </span>
    )
  }
  const color = pct > 0 ? "text-green-600" : pct < 0 ? "text-red-600" : "text-deep-violet-blue/60"
  return (
    <span className={`shrink-0 text-xs font-medium tabular-nums ${color}`}>
      {pct > 0 ? "▲ " : pct < 0 ? "▼ " : ""}
      {formatChangePct(pct)}
    </span>
  )
}

// One period's revenue and units on a line. With a comparison, a format
// tile leads each line with its format's swatch — solid for this period,
// hatched for the comparison — drawn exactly like that format's bars in the
// chart, so the figures can't be mistaken for each other. The Total tile is
// every format, so it has no one colour: its comparison line reads "vs"
// instead. Hovering names the period. A period with no sales rows reads "No
// sales data" rather than a $0 that looks like a real zero, matching the
// Comparison card's period rows.
function PeriodFigures({ totals, periodName, hatched = false, comparing, color = null, available = true }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5" title={comparing ? periodName : undefined}>
      {comparing && color && <PeriodSwatch color={color} tint={hatchTint(color)} hatched={hatched} />}
      {comparing && !color && hatched && <span className="text-xs text-deep-violet-blue/60">vs</span>}
      {available ? (
        <>
          <p className={`tabular-nums ${hatched ? "text-xs text-deep-violet-blue/70" : "text-sm font-semibold"}`}>
            ${totals.revenue.toLocaleString()}
          </p>
          <p className="text-xs text-deep-violet-blue/60 tabular-nums">{totals.units.toLocaleString()} units</p>
        </>
      ) : (
        <p className={`text-deep-violet-blue/50 ${hatched ? "text-xs" : "text-sm"}`}>No sales data</p>
      )}
    </div>
  )
}

// Compact tile: format + share of total with the change on the first line,
// bold revenue with units on the second, and — with a comparison — the
// comparison's revenue and units on a third, muted line. No "Revenue:" /
// "Units:" labels — position and weight tell them apart. A plain bordered
// div rather than the Card primitive, whose header/content spacing made
// these tall. Lines wrap rather than clip if a tile gets very narrow.
// `available` / `baselineAvailable` say whether each period has sales rows
// for this tile; without both there is no fair change, so it reads "N/A".
function SummaryCard({
  title,
  totals,
  share = null,
  shareLabel = "",
  baselineTotals = null,
  periodNames = null,
  emphasis = false,
  color = null,
  available = true,
  baselineAvailable = true,
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
        <CardChange
          current={totals.revenue}
          baseline={baselineTotals?.revenue ?? null}
          available={available && baselineAvailable}
        />
      </div>
      <PeriodFigures
        totals={totals}
        periodName={periodNames?.current}
        comparing={Boolean(baselineTotals)}
        color={color}
        available={available}
      />
      {baselineTotals && (
        <PeriodFigures
          totals={baselineTotals}
          periodName={periodNames?.baseline}
          hatched
          comparing
          color={color}
          available={baselineAvailable}
        />
      )}
    </div>
  )
}

// Placeholder tiles on the same grid as the real ones, so nothing jumps when
// the figures arrive. `count` includes the Total tile.
function SummaryCardsSkeleton({ count }) {
  return (
    <div role="status">
      <span className="sr-only">Loading sell-out summary…</span>
      <div aria-hidden="true" className={TILE_GRID_CLASS}>
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className={`min-w-[8rem] rounded-lg border border-lavander px-2.5 py-1.5 ${
              index === 0 ? "col-span-2 sm:col-span-1" : ""
            }`}
          >
            <Skeleton className="h-3 w-16 rounded bg-lavander" />
            <Skeleton className="mt-2 h-4 w-24 rounded bg-lavander" />
          </div>
        ))}
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
// same format in the baseline — and the mix bar adds the baseline's mix as
// a second, hatched bar, so a shift in share is visible at a glance.
// With a comparison, the tiles cover every format in either period, so a
// format never vanishes just because one side has no data: this period's
// formats first (in the API's order), then any only the comparison has.
export default function RevenueSummaryCards({
  summaryByMode = {},
  baselineSummaryByMode = null,
  periodNames = null,
  loading = false,
  error = null,
  mode = "offline",
}) {
  const [mixMetric, setMixMetric] = useState("revenue")
  const [hoveredFormat, setHoveredFormat] = useState(null)
  const salesData = summaryByMode[mode]
  const baselineData = baselineSummaryByMode?.[mode] ?? null
  const currentFormats = salesData?.storeFormats ?? []
  const baselineFormats = baselineData?.storeFormats ?? []
  const total = sumFormats(currentFormats)
  const currentByFormat = new Map(currentFormats.map((format) => [format.format, format]))
  const baselineByFormat = new Map(baselineFormats.map((format) => [format.format, format]))
  const formatNames = [...new Set([...currentByFormat.keys(), ...baselineByFormat.keys()])]
  const emptyTotals = { revenue: 0, units: 0 }

  return (
    <div className="bg-white rounded-lg border border-lavander shadow-sm p-3 h-full">
      <p className="text-sm font-medium text-deep-violet-blue mb-2">Sell-out Summary</p>

      {/* The hook keeps the previous filters' data while it refetches, so hide
          it rather than show stale figures beside the skeleton. Offline's 4
          formats + Total until a first load says how many there are. */}
      {loading && <SummaryCardsSkeleton count={(salesData?.storeFormats.length ?? 4) + 1} />}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {!loading && salesData && salesData.storeFormats.length > 1 && (
        <FormatMixBar
          formats={salesData.storeFormats}
          baselineFormats={baselineData?.storeFormats ?? null}
          names={periodNames}
          metric={mixMetric}
          onMetricChange={setMixMetric}
          highlighted={hoveredFormat}
          onHover={setHoveredFormat}
        />
      )}

      {!loading && salesData && (
        <div className={TILE_GRID_CLASS}>
          <SummaryCard
            title="Total"
            totals={total}
            baselineTotals={baselineData ? sumFormats(baselineData.storeFormats) : null}
            periodNames={periodNames}
            available={currentFormats.length > 0}
            baselineAvailable={baselineFormats.length > 0}
            emphasis
            className="col-span-2 sm:col-span-1"
          />
          {formatNames.map((name) => {
            const format = currentByFormat.get(name)
            return (
              <SummaryCard
                key={name}
                title={name}
                totals={format ?? emptyTotals}
                share={format && total[mixMetric] ? (format[mixMetric] / total[mixMetric]) * 100 : null}
                shareLabel={mixMetric === "units" ? "Share of total volume" : "Share of total revenue"}
                color={formatColor(name)}
                    available={Boolean(format)}
                baselineAvailable={baselineByFormat.has(name)}
                highlighted={hoveredFormat === name}
                onHover={setHoveredFormat}
                baselineTotals={baselineData ? (baselineByFormat.get(name) ?? emptyTotals) : null}
                periodNames={periodNames}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
