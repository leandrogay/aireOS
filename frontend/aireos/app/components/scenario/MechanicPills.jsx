import { cn } from '@/lib/utils';
import { formatMonthLabel } from '@/app/utils/forecastView';

// Where a promotion's mechanics come from, in the words the Monthly plan
// and an opened month both use.
export const PROMOTION_SOURCE_LABELS = {
  lastYear: 'Same month last year',
  runRate: 'Recent months',
  planned: 'Planned',
};

// Filled: ran in the same month last year. Dashed: ran in the recent
// (run-rate) months. Blue: planned on the Promotions page, the official
// promotions' colour on the chart (COMPOSITION_LAYERS).
const PILL_STYLES = {
  lastYear: 'bg-lavander text-deep-violet-blue',
  runRate: 'border border-dashed border-deep-violet-blue/35 bg-white text-deep-violet-blue/75',
  planned: 'border border-[#5B8DEF]/60 bg-[#5B8DEF]/15 text-deep-violet-blue',
};

const PILL_HINTS = {
  lastYear: 'Ran in the same month last year',
  runRate: 'Ran in the recent months Tier 0 averages',
  planned: 'Planned on the Promotions page',
};

/**
 * "Jan 2026" or "Jun 2026 – Aug 2026" for the months a group of mechanics ran in.
 *
 * @param {string[]} months 'YYYY-MM-01', sorted
 */
export function monthSpan(months) {
  if (!months.length) return '';
  const first = formatMonthLabel(months[0]);
  const last = formatMonthLabel(months[months.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * A promotion's mechanics as pills, one per mechanic, styled by where they
 * come from (`kind`). Used by the Monthly plan's Promotions column and an
 * opened month (Tier0Details), so the two read the same.
 *
 * @param {{ kind: 'lastYear' | 'runRate' | 'planned', mechanics: string[] }} props
 */
export default function MechanicPills({ kind, mechanics }) {
  if (!mechanics.length) return <span className="text-[11px] text-deep-violet-blue/50">No promotion</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {mechanics.map((mechanic) => (
        <span
          key={mechanic}
          title={`${mechanic}: ${PILL_HINTS[kind].toLowerCase()}`}
          className={cn(
            'inline-flex items-center whitespace-nowrap rounded-full px-2 py-px text-[10px] font-semibold',
            PILL_STYLES[kind]
          )}
        >
          {mechanic}
        </span>
      ))}
    </span>
  );
}
