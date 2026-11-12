'use client';

import { cn } from '@/lib/utils';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import YearChangeDetails from './YearChangeDetails';
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
      <TooltipTrigger delay={150} closeDelay={100} className="ml-auto inline-flex min-w-0 flex-wrap items-center justify-end gap-1">
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

/**
 * Annual figures use one compact summary row; its change opens the
 * contribution breakdown. Saved/draft pills stay to the right of Simulated.
 * @param {{ rows: object[], loading?: boolean, baseLabel?: string }} props
 */
export default function ScenarioYearComparison({ rows, loading = false, baseLabel = 'Current' }) {
  const compare = rows.some((row) => row.items.some((item) => !item.notCounted));
  const columns = [
    { key: 'period', label: 'Period', width: '15rem' },
    { key: 'base', label: baseLabel, ...(compare ? { width: '9rem' } : {}) },
    ...(compare ? [
      { key: 'simulated', label: 'Simulated' },
      { key: 'delta', label: `Δ vs ${baseLabel}`, width: '9rem' },
      { key: 'deltaPct', label: 'Δ%', width: '8rem' },
    ] : []),
  ];
  const cell = 'px-4 py-2.5 text-left align-middle tabular-nums';
  return (
    <section aria-label="Current and simulated totals">
      {compare ? <p className="px-4 pb-3 text-xs text-deep-violet-blue/60">Select a change figure to see its contributions.</p> : null}
      <TableGrid columns={columns} minWidth={compare ? '56rem' : '28rem'} isLoading={loading} skeletonRows={3}
        emptyState={!loading && !rows.length ? 'No yearly figures in this period.' : null}>
        {!loading && rows.map((row) => {
          const changed = Boolean(row.delta) && row.current != null;
          const hasParts = Object.values(row.parts ?? {}).some((value) => Math.round(value));
          return (
            <TableRow key={row.key} className="h-12">
              <td className={cell}>
                <span className="block font-medium">{row.label}</span>
                {row.caption ? <span className="block text-xs text-deep-violet-blue/50">{row.caption}</span> : null}
              </td>
              <td className={cell}>{formatFigure(row.current)}</td>
              {compare ? (
                <>
                  <td className={cell}>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold">{row.current == null ? '—' : formatFigure(row.current + row.delta)}</span>
                      {row.items.length ? <ItemsBadge items={row.items} /> : null}
                    </div>
                  </td>
                  <td className={cn(cell, changed || hasParts ? 'font-semibold text-scenario-ink' : 'text-deep-violet-blue/45')}>
                    {row.current != null && (changed || hasParts) ? <YearChangeDetails row={row} /> : '—'}
                  </td>
                  <td className={cn(cell, changed ? 'font-semibold text-scenario-ink' : 'text-deep-violet-blue/45')}>
                    {changed && row.current ? `${row.delta < 0 ? '−' : '+'}${Math.abs((row.delta / row.current) * 100).toFixed(1)}%` : '—'}
                  </td>
                </>
              ) : null}
            </TableRow>
          );
        })}
      </TableGrid>
    </section>
  );
}
