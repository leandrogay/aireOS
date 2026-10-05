'use client';

import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatColor as colorFor } from '@/app/utils/storeFormats';
import { edgeColor } from '@/components/dashboard/PeriodTexture';

// Matches RevenueTrendCard's toggles: dark blue for the selected option.
const tabTriggerClass =
  'text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white data-active:hover:text-white';

const METRICS = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'units', label: 'Volume' },
];

function formatShare(share) {
  return share > 0 && share < 1 ? '<1%' : `${share.toFixed(0)}%`;
}

function amountText(format, metric) {
  return metric === 'units' ? `${format.units.toLocaleString()} units` : `$${format.revenue.toLocaleString()}`;
}

function tooltipText(format, metric, share) {
  return `${format.format}: ${amountText(format, metric)} (${formatShare(share)})`;
}

// With a comparison: "SUPER: 32% ($6,097) vs 20% ($2,123)".
function comparisonTooltipText(current, baseline) {
  const side = (segment) =>
    segment ? `${formatShare(segment.share)} (${amountText(segment.format, segment.metric)})` : '0%';
  return `${(current ?? baseline).format.format}: ${side(current)} vs ${side(baseline)}`;
}

// Each format's share plus where its middle sits along the bar, so the
// tooltip can be centred over it without living inside the clipped track.
function segmentsFor(formats, metric) {
  const total = formats.reduce((sum, format) => sum + format[metric], 0);
  const segments = [];
  let offset = 0;
  for (const format of formats) {
    if (!total || format[metric] <= 0) continue;
    const share = (format[metric] / total) * 100;
    segments.push({ format, metric, share, middle: offset + share / 2 });
    offset += share;
  }
  return segments;
}

// The comparison's formats in this period's order, so the same format sits
// at about the same place in both bars and a mix shift reads as a boundary
// moving. Formats only the comparison had go last.
function inOrderOf(formats, order) {
  const rank = (format) => {
    const index = order.findIndex((o) => o.format === format.format);
    return index === -1 ? order.length : index;
  };
  return [...formats].sort((a, b) => rank(a) - rank(b));
}

/**
 * "Storage bar" showing each store format's share of the channel's total
 * revenue or volume: one rounded track, one coloured segment per format
 * sized to its share (same colours as the trend chart). Hovering or
 * focusing a segment shows its figures and reports the format up via
 * `onHover`, so RevenueSummaryCards can highlight the matching tile — and
 * a tile being hovered (`highlighted`) highlights its segment back.
 *
 * With `baselineFormats` (a "Compare to" period is on) a second bar shows
 * the comparison's mix under this period's, hatched like the comparison
 * bars in the trend chart, each bar labelled with its period's name.
 * Hovering a format highlights it in both bars and the tooltip gives both
 * shares.
 *
 * @param {{
 *   formats: Array<{ format: string, revenue: number, units: number }>,
 *   baselineFormats?: Array<{ format: string, revenue: number, units: number }> | null,
 *   names?: { current: string, baseline: string } | null,
 *   metric: 'revenue' | 'units',
 *   onMetricChange: (metric: 'revenue' | 'units') => void,
 *   highlighted: string | null,
 *   onHover: (format: string | null) => void,
 * }} props
 */
export default function FormatMixBar({
  formats,
  baselineFormats = null,
  names = null,
  metric,
  onMetricChange,
  highlighted,
  onHover,
}) {
  const segments = segmentsFor(formats, metric);
  if (segments.length === 0) return null;
  const baselineSegments = baselineFormats ? segmentsFor(inOrderOf(baselineFormats, formats), metric) : null;
  const comparing = Boolean(baselineSegments?.length);
  const bars = [{ key: 'current', label: names?.current, segments, hatched: false }];
  if (comparing) bars.push({ key: 'baseline', label: names?.baseline, segments: baselineSegments, hatched: true });

  const active = segments.find((segment) => segment.format.format === highlighted);
  const activeBaseline = comparing
    ? baselineSegments.find((segment) => segment.format.format === highlighted)
    : null;
  const tooltipAnchor = active ?? activeBaseline;

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs text-deep-violet-blue/70">Format mix</p>
        {/* Same Tabs styling as the trend card's By week / By month switch. */}
        <Tabs value={metric} onValueChange={onMetricChange}>
          <TabsList className="h-7 bg-lavander">
            {METRICS.map((m) => (
              <TabsTrigger key={m.value} value={m.value} className={`text-xs ${tabTriggerClass}`}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-1.5">
        {bars.map((bar) => (
          <div key={bar.key} className="flex items-center gap-2">
            {comparing && (
              <span className="w-36 shrink-0 truncate text-xs text-deep-violet-blue/70" title={bar.label}>
                {bar.label}
              </span>
            )}
            <div className="relative flex-1">
              {bar.key === 'current' && tooltipAnchor && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-lavander bg-white px-2 py-1 text-xs font-medium text-deep-violet-blue shadow-md"
                  style={{ left: `${Math.min(Math.max(tooltipAnchor.middle, 10), 90)}%` }}
                >
                  {comparing
                    ? comparisonTooltipText(active, activeBaseline)
                    : tooltipText(active.format, metric, active.share)}
                </div>
              )}
              <div className="flex h-2.5 gap-px overflow-hidden rounded-full bg-cream">
                {bar.segments.map(({ format, share }) => {
                  const color = colorFor(format.format);
                  return (
                    <div
                      key={format.format}
                      role="img"
                      tabIndex={0}
                      aria-label={`${bar.label ? `${bar.label} · ` : ''}${tooltipText(format, metric, share)}`}
                      onMouseEnter={() => onHover(format.format)}
                      onMouseLeave={() => onHover(null)}
                      onFocus={() => onHover(format.format)}
                      onBlur={() => onHover(null)}
                      className={cn(
                        'h-full min-w-[3px] cursor-default transition-opacity focus:outline-none',
                        highlighted && highlighted !== format.format && 'opacity-40',
                      )}
                      style={{
                        width: `${share}%`,
                        background: bar.hatched
                          ? `repeating-linear-gradient(45deg, ${edgeColor(color)} 0 1.5px, color-mix(in srgb, ${color} 50%, var(--card)) 1.5px 4px)`
                          : color,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
