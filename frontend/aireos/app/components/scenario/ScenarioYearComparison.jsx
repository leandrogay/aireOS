'use client';

import { cn } from '@/lib/utils';
import { HEADER_RULE } from '@/components/forecast/ForecastYearTotals';
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

// What each part changes on Current, in the chart's stacking order; a part
// shows only when it changes something in some row.
const PART_COLUMNS = [
  { part: 'official', label: 'Official promotions' },
  { part: 'carried', label: "Last year's promotions left out" },
  { part: 'growth', label: 'Growth' },
  { part: 'blocks', label: 'Building blocks' },
  { part: 'promotions', label: 'Scenario promotions' },
];

const headerCell = cn(
  'border-b bg-cream px-2.5 py-1.5 text-left align-middle text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue',
  HEADER_RULE
);

/**
 * Scenario builder's comparison table, under the chart, in units (the
 * scenario predicts volume only): each year in view and the next 12
 * months, Current against Simulated with the change, and what each part
 * (official promotions, growth, building blocks, scenario promotions, last
 * year's promotions when left out) adds to it. Styled like
 * ForecastYearTotals, whose /forecast table it stands in for here.
 *
 * Until a switched-on block or promotion changes something in view (`rows`
 * all carry zero of both), it shows Current only: no Simulated, Δ or Δ% columns.
 *
 * @param {{
 *   rows: Array<{ key: string, label: string, caption?: string,
 *     current: number | null, delta: number,
 *     parts?: Record<string, number>,
 *     items: Array<{ id: string, name: string, kind: 'block' | 'promotion',
 *       state: 'saved' | 'draft' | 'edited', deltaUnits: number }> }>,
 *   loading?: boolean,
 * }} props
 */
export default function ScenarioYearComparison({ rows, loading = false }) {
  if (loading) {
    return <div className="h-12 animate-pulse rounded-md border border-lavander bg-white" />;
  }
  if (!rows.length) return null;

  // Items that change nothing (notCounted) are listed but don't open the
  // Simulated columns on their own.
  const compare = rows.some((row) => row.items.some((item) => !item.notCounted));
  const parts = PART_COLUMNS.filter((column) => rows.some((row) => Math.round(row.parts?.[column.part] ?? 0)));

  return (
    <section aria-label="Current and simulated totals" className="overflow-x-auto rounded-md border border-lavander">
      <table className="w-full border-separate border-spacing-0 text-xs text-deep-violet-blue">
        <thead>
          <tr>
            <th className={headerCell}>Period</th>
            <th className={headerCell}>Current</th>
            {compare ? (
              <>
                {parts.map((column) => (
                  <th key={column.part} className={headerCell}>
                    {column.label}
                  </th>
                ))}
                <th className={headerCell}>Simulated</th>
                <th className={headerCell}>Δ</th>
                <th className={headerCell}>Δ%</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rule = index < rows.length - 1 ? 'border-b border-lavander/70' : '';
            const changed = Boolean(row.delta) && row.current != null;
            // Left-aligned and vertically centred, as the Monthly plan.
            const cell = cn('whitespace-nowrap px-2.5 py-1.5 text-left align-middle tabular-nums', rule);
            return (
              <tr key={row.key} className="bg-white">
                <td className={cn('whitespace-nowrap px-2.5 py-1.5 text-left align-middle', rule)}>
                  <span className="font-medium">{row.label}</span>
                  {row.caption ? (
                    <span className="ml-1.5 text-[10px] font-normal text-deep-violet-blue/50">{row.caption}</span>
                  ) : null}
                </td>
                <td className={cell}>{formatFigure(row.current)}</td>
                {compare ? (
                  <>
                    {parts.map((column) => {
                      const value = row.parts?.[column.part] ?? 0;
                      return (
                        <td key={column.part} className={cn(cell, Math.round(value) ? 'text-scenario-ink' : 'text-deep-violet-blue/45')}>
                          {Math.round(value) && row.current != null ? signedFigure(value) : '—'}
                        </td>
                      );
                    })}
                    <td className={cell}>
                      {row.items.length ? <ItemsBadge items={row.items} /> : null}
                      {row.current == null ? '—' : formatFigure(row.current + row.delta)}
                    </td>
                    <td className={cn(cell, changed ? 'font-semibold text-scenario-ink' : 'text-deep-violet-blue/45')}>
                      {changed ? signedFigure(row.delta) : '—'}
                    </td>
                    <td className={cn(cell, changed ? 'font-semibold text-scenario-ink' : 'text-deep-violet-blue/45')}>
                      {changed && row.current
                        ? `${row.delta < 0 ? '−' : '+'}${Math.abs((row.delta / row.current) * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

