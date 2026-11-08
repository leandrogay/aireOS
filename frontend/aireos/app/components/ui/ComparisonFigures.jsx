import { Info } from 'lucide-react';

import { formatChangePct } from '@/app/utils/periodComparison';
import { cn } from '@/lib/utils';

// The pieces of a "Comparison" card (dashboard PeriodComparisonDetail,
// inventory SellInComparison): headline % changes, smaller ones, and the
// note underneath. Green up, red down, always; any caveat goes in the note.

// The change as shown (to `decimals` places), so a figure that reads "0.0%"
// never gets an arrow or a colour.
function shown(pct, decimals) {
  if (pct === null) return null;
  const scale = 10 ** decimals;
  return Math.round(pct * scale) / scale;
}

function toneClass(pct, decimals) {
  const value = shown(pct, decimals);
  if (value === null || value === 0) return 'text-deep-violet-blue/70';
  return value > 0 ? 'text-green-600' : 'text-red-600';
}

function Arrow({ pct, decimals }) {
  const value = shown(pct, decimals);
  if (value > 0) return <span aria-hidden="true">▲ </span>;
  if (value < 0) return <span aria-hidden="true">▼ </span>;
  return null;
}

/**
 * A headline change, "▲ +12.8%" under its label. With no change to show (a
 * side has no data, or the base is zero) it reads "N/A" in a muted tone with
 * no arrow, so missing data never looks like a -100% collapse. `detail` is a
 * small line underneath (e.g. "+302 units"). `decimals`: places shown, 1 by
 * default (the dashboard); 2 where a small miss matters (inventory).
 *
 * @param {{ label: string, pct: number | null, detail?: string, decimals?: number }} props
 */
export function ChangeFigure({ label, pct, detail, decimals = 1 }) {
  return (
    <div className="flex-1">
      <p className="text-xs text-deep-violet-blue/70">{label}</p>
      {pct === null ? (
        <p className="text-xl font-semibold text-deep-violet-blue/40" title="Data not available">
          N/A
        </p>
      ) : (
        <p className={cn('text-xl font-semibold tabular-nums', toneClass(pct, decimals))}>
          <Arrow pct={pct} decimals={decimals} />
          {formatChangePct(pct, decimals)}
        </p>
      )}
      {detail ? <p className="text-xs tabular-nums text-deep-violet-blue/60">{detail}</p> : null}
    </div>
  );
}

/**
 * A smaller "▲ +12.8%" for the figures under the headline.
 *
 * @param {{ pct: number | null, decimals?: number }} props
 */
export function ChangeValue({ pct, decimals = 1 }) {
  return (
    <span className={cn('font-medium tabular-nums', toneClass(pct, decimals))}>
      <Arrow pct={pct} decimals={decimals} />
      {formatChangePct(pct, decimals)}
    </span>
  );
}

/**
 * The neutral note at the foot of a comparison, for when it needs explaining.
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export function ComparisonNote({ children }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-md bg-lavander/60 px-2 py-1 text-xs text-deep-violet-blue">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
