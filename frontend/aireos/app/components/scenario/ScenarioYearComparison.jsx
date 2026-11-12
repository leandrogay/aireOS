'use client';

import { cn } from '@/lib/utils';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function formatFigure(value) {
  if (value == null) return '—';
  return Math.round(value).toLocaleString('en-US');
}

function signedFigure(value) {
  return `${value < 0 ? '−' : '+'}${formatFigure(Math.abs(value))}`;
}

// Saved items first, then the ones only on screen: never saved, or saved
// with edits not saved yet.
const ITEM_STATES = [
  { key: 'saved', label: 'saved', hover: 'Saved' },
  { key: 'draft', label: 'draft', hover: 'Unsaved draft' },
  { key: 'edited', label: 'edited', hover: 'Unsaved edits' },
];

const pillClass = 'inline-block rounded-full px-2 py-px align-[1px] text-[10px] font-semibold';

// "1 saved active" or "1 saved + 1 draft": what makes up the row's
// Simulated figure. Drafts and unsaved edits get an outlined pill, since
// they change the line but aren't saved; hovering lists every item.
function ItemsBadge({ items }) {
  const groups = ITEM_STATES.map((state) => ({
    ...state,
    items: items.filter((item) => item.state === state.key),
  })).filter((group) => group.items.length);

  return (
    <Tooltip>
      <TooltipTrigger delay={150} closeDelay={100} className="mr-1.5 inline-flex items-center gap-1 align-[1px]">
        {groups.map((group, index) => (
          <span key={group.key} className="inline-flex items-center gap-1">
            {index ? <span className="text-[10px] text-deep-violet-blue/50">+</span> : null}
            <span
              className={cn(
                pillClass,
                group.key === 'saved'
                  ? 'bg-scenario-soft text-scenario-ink'
                  : 'border border-dashed border-scenario/60 bg-white text-scenario-ink'
              )}
            >
              {group.items.length} {group.label}
              {groups.length === 1 && group.key === 'saved' ? ' active' : ''}
            </span>
          </span>
        ))}
      </TooltipTrigger>
      <TooltipContent className="block max-w-72 text-left font-normal leading-snug">
        <ul className="space-y-0.5">
          {groups.flatMap((group) =>
            group.items.map((item) => (
              <li key={item.id} className="tabular-nums">
                • {group.hover} {item.kind}: {item.name || 'Untitled'}{' '}
                {item.notCounted
                  ? '(no change: its months have actual sales)'
                  : `(${signedFigure(item.deltaUnits)} units)`}
              </li>
            ))
          )}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

const CURRENT_COLUMNS = [
  { key: 'period', label: 'Period' },
  { key: 'current', label: 'Current', width: '9rem', align: 'right' },
];
const COMPARE_COLUMNS = [
  ...CURRENT_COLUMNS,
  { key: 'simulated', label: 'Simulated', width: '15rem', align: 'right' },
  { key: 'delta', label: 'Δ', width: '7rem', align: 'right' },
  { key: 'deltaPct', label: 'Δ%', width: '6rem', align: 'right' },
];

const CELL_CLASS = 'px-4 py-2.5';
const NUMBER_CELL_CLASS = 'px-4 py-2.5 text-right tabular-nums';

function deltaPercent(row) {
  return `${row.delta < 0 ? '−' : '+'}${Math.abs((row.delta / row.current) * 100).toFixed(1)}%`;
}

/**
 * Scenario builder's comparison table, under the chart, in units (the
 * scenario predicts volume only): each year in view and the next 12
 * months, Current against Simulated with the change. On the shared
 * TableGrid, like ForecastYearTotals, whose /forecast table it stands in for
 * here; nested, since it sits in the chart card's By year tab.
 *
 * Until a switched-on block or promotion changes something in view (`rows`
 * all carry zero of both), it shows Current only: no Simulated, Δ or Δ% columns.
 *
 * @param {{
 *   rows: Array<{ key: string, label: string, caption?: string,
 *     current: number | null, delta: number,
 *     items: Array<{ id: string, name: string, kind: 'block' | 'promotion',
 *       state: 'saved' | 'draft' | 'edited', deltaUnits: number }> }>,
 *   loading?: boolean,
 * }} props
 */
export default function ScenarioYearComparison({ rows, loading = false }) {
  if (!loading && !rows.length) return null;

  // Items that change nothing (notCounted) are listed but don't open the
  // Simulated columns on their own.
  const compare = rows.some((row) => row.items.some((item) => !item.notCounted));

  return (
    <section aria-label="Current and simulated totals">
      <TableGrid
        variant="nested"
        columns={compare ? COMPARE_COLUMNS : CURRENT_COLUMNS}
        minWidth={compare ? '46rem' : '24rem'}
        isLoading={loading}
        skeletonRows={2}
      >
        {!loading && rows.map((row) => {
          const changed = Boolean(row.delta) && row.current != null;
          const changeClass = cn(NUMBER_CELL_CLASS, changed ? 'font-semibold text-scenario-ink' : 'text-deep-violet-blue/45');
          return (
            <TableRow key={row.key} className="border-b border-lavander/80 last:border-b-0">
              <td className={cn(CELL_CLASS, 'truncate')}>
                <span className="font-medium">{row.label}</span>
                {row.caption ? (
                  <span className="ml-2 text-xs text-deep-violet-blue/55">{row.caption}</span>
                ) : null}
              </td>
              <td className={NUMBER_CELL_CLASS}>{formatFigure(row.current)}</td>
              {compare ? (
                <>
                  <td className={NUMBER_CELL_CLASS}>
                    {row.items.length ? <ItemsBadge items={row.items} /> : null}
                    {row.current == null ? '—' : formatFigure(row.current + row.delta)}
                  </td>
                  <td className={changeClass}>{changed ? signedFigure(row.delta) : '—'}</td>
                  <td className={changeClass}>{changed && row.current ? deltaPercent(row) : '—'}</td>
                </>
              ) : null}
            </TableRow>
          );
        })}
      </TableGrid>
    </section>
  );
}
