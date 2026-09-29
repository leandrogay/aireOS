'use client';

import { cn } from '@/lib/utils';
import { FALLBACK_FORMAT_COLOR, FORMAT_COLORS } from '@/app/utils/storeFormats';

const METRICS = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'units', label: 'Volume' },
];

function formatShare(share) {
  return share > 0 && share < 1 ? '<1%' : `${share.toFixed(0)}%`;
}

function tooltipText(format, metric, share) {
  const amount =
    metric === 'units' ? `${format.units.toLocaleString()} units` : `$${format.revenue.toLocaleString()}`;
  return `${format.format}: ${amount} (${formatShare(share)})`;
}

/**
 * "Storage bar" showing each store format's share of the channel's total
 * revenue or volume: one rounded track, one coloured segment per format
 * sized to its share (same colours as the trend chart). Hovering or
 * focusing a segment shows its figures and reports the format up via
 * `onHover`, so RevenueSummaryCards can highlight the matching tile — and
 * a tile being hovered (`highlighted`) highlights its segment back.
 *
 * @param {{
 *   formats: Array<{ format: string, revenue: number, units: number }>,
 *   metric: 'revenue' | 'units',
 *   onMetricChange: (metric: 'revenue' | 'units') => void,
 *   highlighted: string | null,
 *   onHover: (format: string | null) => void,
 * }} props
 */
export default function FormatMixBar({ formats, metric, onMetricChange, highlighted, onHover }) {
  const total = formats.reduce((sum, format) => sum + format[metric], 0);
  if (!total) return null;

  // Each segment's share plus where its middle sits along the bar, so the
  // tooltip can be centred over it without living inside the clipped track.
  const segments = [];
  let offset = 0;
  for (const format of formats) {
    if (format[metric] <= 0) continue;
    const share = (format[metric] / total) * 100;
    segments.push({ format, share, middle: offset + share / 2 });
    offset += share;
  }
  const active = segments.find((segment) => segment.format.format === highlighted);

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs text-deep-violet-blue/70">Format mix</p>
        <div className="flex gap-1">
          {METRICS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => onMetricChange(m.value)}
              className={cn(
                'rounded px-1.5 py-0.5 text-xs text-deep-violet-blue/70 hover:text-deep-violet-blue',
                metric === m.value && 'bg-lavander font-medium text-deep-violet-blue',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        {active && (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-lavander bg-white px-2 py-1 text-xs font-medium text-deep-violet-blue shadow-md"
            style={{ left: `${Math.min(Math.max(active.middle, 10), 90)}%` }}
          >
            {tooltipText(active.format, metric, active.share)}
          </div>
        )}
        <div className="flex h-2.5 gap-px overflow-hidden rounded-full bg-cream">
          {segments.map(({ format, share }) => (
            <div
              key={format.format}
              role="img"
              tabIndex={0}
              aria-label={tooltipText(format, metric, share)}
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
                backgroundColor: FORMAT_COLORS[format.format] ?? FALLBACK_FORMAT_COLOR,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
