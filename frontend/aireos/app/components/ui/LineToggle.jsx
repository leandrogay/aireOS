'use client';

import { cn } from '@/lib/utils';

// The pill's sample of its line: a marker shape (the Forecast page), or a
// short stretch of the line itself for charts whose lines differ by dash
// pattern (`shape: 'line'`, inventory SellInOutlookChart).
function SeriesMark({ color, shape, dash, dot }) {
  if (shape === 'line') {
    return (
      <svg viewBox="0 0 22 10" className="h-2.5 w-[22px] shrink-0" aria-hidden="true">
        <line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth="2" strokeDasharray={dash} />
        {dot ? <circle cx="11" cy="5" r="2.5" fill="#fff" stroke={color} strokeWidth="1.5" /> : null}
      </svg>
    );
  }
  if (shape === 'square') {
    return <span className="size-2 shrink-0" style={{ backgroundColor: color }} aria-hidden="true" />;
  }
  if (shape === 'diamond') {
    return (
      <span
        className="size-1.5 shrink-0 rotate-45"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
    );
  }
  if (shape === 'triangle') {
    return (
      <span
        className="shrink-0 border-x-[4px] border-x-transparent border-b-[7px]"
        style={{ borderBottomColor: color }}
        aria-hidden="true"
      />
    );
  }
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />;
}

// One labelled row of pills.
function LineRow({ label, labelClassName, series, visible, onToggle, hints, disabled }) {
  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-2">
      <p className={cn('text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50', labelClassName)}>
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {series.map((line) => {
          const isDisabled = Boolean(disabled[line.key]);
          const isActive = !isDisabled && visible[line.key];
          const hint = hints[line.key];
          const hintId = `line-toggle-hint-${line.key}`;
          return (
            <span key={line.key} className="group inline-flex sm:relative">
              <button
                type="button"
                aria-pressed={isActive}
                aria-disabled={isDisabled || undefined}
                aria-describedby={hint ? hintId : undefined}
                onClick={() => {
                  if (!isDisabled) onToggle(line.key);
                }}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition',
                  isDisabled
                    ? 'cursor-not-allowed border-dashed border-lavander bg-white text-deep-violet-blue/40'
                    : isActive
                      ? 'border-transparent text-deep-violet-blue shadow-sm'
                      : 'border-lavander bg-white text-deep-violet-blue/55 hover:bg-cream'
                )}
                style={
                  isActive
                    ? { backgroundColor: `color-mix(in srgb, ${line.color} 20%, white)` }
                    : undefined
                }
              >
                <span className={cn('inline-flex', isDisabled && 'opacity-40')}>
                  <SeriesMark color={line.color} shape={line.shape} dash={line.dash} dot={line.dot} />
                </span>
                {line.label}
              </button>
              {hint ? (
                <span
                  id={hintId}
                  role="tooltip"
                  className="pointer-events-none invisible absolute left-0 top-full z-40 mt-1.5 w-72 rounded-md border border-lavander bg-white px-2.5 py-2 text-[11px] leading-snug text-deep-violet-blue opacity-0 shadow-md transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
                >
                  {hint}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Chart line on/off pills, shared by every chart with switchable lines (the
 * Forecast page and Scenario builder via ForecastChart, the inventory
 * sell-in plan chart).
 *
 * Give either `series` for one row (labelled `label`, "Lines" by default),
 * or `groups` for several stacked rows, e.g. Sell-in and Sell-out, whose
 * labels share a width so the pills line up. `header` sits above the rows,
 * divided off, for figures that read with the lines (SellInOutlookChart's
 * last-month differences). With `groups` or `header` the rows come in a
 * card.
 *
 * `hints` maps a line key to a short explanation shown on hover or keyboard
 * focus (e.g. why a line is missing). A key in `disabled` is greyed out and
 * can't be turned on (a line with no data yet); it stays focusable so its
 * hint can still be read.
 *
 * @param {{
 *   series?: { key: string, label: string, color: string, shape: string, dash?: string, dot?: boolean }[],
 *   groups?: { label: string, series: object[] }[],
 *   visible: Record<string, boolean>,
 *   onToggle: (key: string) => void,
 *   hints?: Record<string, string | null>,
 *   disabled?: Record<string, boolean>,
 *   label?: string,
 *   header?: import('react').ReactNode,
 * }} props
 */
export default function LineToggle({
  series = [],
  groups = null,
  visible,
  onToggle,
  hints = {},
  disabled = {},
  label = 'Lines',
  header = null,
}) {
  const rows = groups ?? [{ label, series }];
  const stacked = rows.length > 1;
  const rowProps = { visible, onToggle, hints, disabled };

  if (!stacked && !header) {
    return <LineRow label={label} series={series} {...rowProps} />;
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-lavander bg-white px-3 py-2">
      {header ? <div className="border-b border-lavander pb-1.5">{header}</div> : null}
      {rows.map((row) => (
        <LineRow
          key={row.label}
          label={row.label}
          labelClassName={stacked ? 'w-14 shrink-0' : undefined}
          series={row.series}
          {...rowProps}
        />
      ))}
    </div>
  );
}
