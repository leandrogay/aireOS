'use client';

import Link from 'next/link';
import { ChevronDown, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HEADER_RULE } from '@/components/forecast/ForecastYearTotals';
import { buttonVariants } from '@/components/ui/button';
import ExpandableRow from '@/components/ui/ExpandableRow';
import StatusPill from '@/components/ui/StatusPill';
import { formatMonthLabel } from '@/app/utils/forecastView';
import useExpandedRows from '@/hooks/useExpandedRows';

import MechanicPills, { PROMOTION_SOURCE_LABELS, monthSpan } from './MechanicPills';

// One line while the table has room (the @container below); headers wrap
// only once it is narrow.
const headerCell = cn(
  'border-b bg-cream px-2 py-1.5 text-left align-middle text-[10px] font-bold uppercase leading-tight tracking-wide text-deep-violet-blue @4xl:whitespace-nowrap',
  HEADER_RULE
);

function units(value) {
  return Math.round(value).toLocaleString('en-US');
}

function signed(value, format) {
  return `${value < 0 ? '−' : '+'}${format(Math.abs(value))}`;
}

function percent(share) {
  return share == null ? '—' : `${share < 0 ? '−' : '+'}${Math.abs(share * 100).toFixed(1)}%`;
}

// Headers and cells are all left-aligned and vertically centred.
function Header({ label, hint, className }) {
  return (
    <th className={cn(headerCell, className)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {hint ? <InfoTooltip label={`About ${label}`}>{hint}</InfoTooltip> : null}
      </span>
    </th>
  );
}

const chipClass =
  'mt-1 inline-flex max-w-[7.5rem] items-center gap-1 rounded-full px-2 py-px text-[10px] font-semibold text-scenario-ink';
// Saved items in a filled chip; drafts and unsaved edits outlined and
// dashed, as in the By year badge (ScenarioYearComparison), since they move
// the line without being saved.
const savedChip = 'bg-scenario-soft hover:bg-scenario/15';
const unsavedChip = 'border border-dashed border-scenario/60 bg-white hover:bg-scenario-soft';
const STATE_TAGS = { draft: 'Draft', edited: 'Unsaved edits' };

// "2 blocks" or "2 blocks · 1 draft" for a month several items add to.
function manyLabel(items) {
  const unsaved = items.filter((item) => item.state !== 'saved').length;
  return `${items.length} blocks${unsaved ? ` · ${unsaved} unsaved` : ''}`;
}

// The blocks adding to a month: one opens straight away; several open a
// short list to pick from.
function BlockLinks({ items, onOpen }) {
  if (items.length === 1) {
    const [item] = items;
    const tag = STATE_TAGS[item.state];
    return (
      <button
        type="button"
        onClick={() => onOpen(item.itemId)}
        className={cn(chipClass, tag ? unsavedChip : savedChip)}
        title={tag ? `Edit ${item.name} (${tag.toLowerCase()})` : `Edit ${item.name}`}
      >
        <span className="truncate">{item.name}</span>
      </button>
    );
  }
  const anyUnsaved = items.some((item) => item.state !== 'saved');
  return (
    <Popover>
      <PopoverTrigger className={cn(chipClass, anyUnsaved ? unsavedChip : savedChip)}>
        <span className="truncate">{manyLabel(items)}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 bg-white p-1.5">
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
          Open in the panel
        </p>
        {items.map((item) => (
          <button
            key={item.itemId}
            type="button"
            onClick={() => onOpen(item.itemId)}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-deep-violet-blue hover:bg-cream"
          >
            <span className="truncate">{item.name}</span>
            {STATE_TAGS[item.state] ? (
              <span className="shrink-0 rounded-full border border-dashed border-scenario/60 px-1.5 text-[10px] text-scenario-ink">
                {STATE_TAGS[item.state]}
              </span>
            ) : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// The parts of the Simulated figure, in the order the chart stacks them.
// `part` is the plan row's parts key. Last year's and official
// promotions share one column, since a planned promotion takes the place
// of last year's: each month says which it is and the mechanics behind it.
const PART_COLUMNS = [
  {
    part: 'baseline',
    label: 'Baseline',
    hint: 'An ordinary month at the anchor: Tier 0 with the promotions of the months it is built from taken out.',
    split: true,
  },
  {
    part: 'promotionLines',
    label: 'Promotions',
    hint: "What promotions add to the baseline. Last year's: carried by Tier 0 until a promotion is planned (negative when they sold less than an ordinary month); filled pills ran in the same month last year, dashed ones in the recent months Tier 0 averages. Planned (blue): official promotions on the Promotions page, in their place.",
    split: true,
  },
  { part: 'growth', label: 'Growth', hint: 'Growth on Tier 0, set in the Breakdown tab.' },
  { part: 'blocks', label: 'Building blocks', hint: 'What the switched-on building blocks add this month.' },
  {
    part: 'promotions',
    label: 'Scenario promotions',
    hint: 'What the promotions planned here add, on the baseline.',
  },
];

// A column shows only when some month has something in it.
function columnHasValues(column, rows) {
  if (column.part === 'baseline' || column.part === 'tier0') return true;
  if (column.part === 'promotionLines') return rows.some((row) => row.promotionLines.length);
  return rows.some(
    (row) =>
      Math.round(row.parts?.[column.part] ?? (column.part === 'blocks' ? row.blocks.units : 0)) ||
      (column.part === 'blocks' && row.items.some((item) => item.source === 'blocks'))
  );
}

/**
 * The Scenario builder's monthly plan for the filters' scope: one row per
 * forecast month with Last year actual, what the Simulated figure is made
 * of part by part (the baseline, promotions -- last year's or the official
 * ones planned, with their mechanics -- growth, building blocks, scenario
 * promotions; a part empty in every month has no column) and the variance against last year. Each month says
 * whether its promotions are planned on the Promotions page.
 * Opening a month shows how its Tier 0 is built (`detailsFor`). A block's
 * name opens it in the panel. All numbers come from scenarioPlan.buildPlanRows.
 *
 * @param {{
 *   rows: ReturnType<typeof import('@/app/utils/scenarioPlan').buildPlanRows>,
 *   lastYearLoading: boolean,
 *   onOpenItem: (itemId: string) => void,
 *   scope: string,
 *   split: boolean,                   Tier 0 is split (else one Tier 0 column)
 *   detailsFor: (month: string) => import('react').ReactNode,
 *   flagged: (month: string) => boolean, the month moves more than 35% (Big change)
 * }} props
 */
export default function MonthlyPlanTable({ rows, lastYearLoading, onOpenItem, scope, split, detailsFor, flagged }) {
  const expanded = useExpandedRows();
  if (!rows.length) {
    return (
      <p className="rounded-md border border-lavander bg-white px-3 py-3 text-xs text-deep-violet-blue/60">
        No forecast months in this period. Pick a period that reaches into the forecast to plan building blocks.
      </p>
    );
  }

  const columns = PART_COLUMNS.filter((column) => !column.split || split);
  // Without the split, Tier 0 is one column.
  const partColumns = (
    split
      ? columns
      : [{ part: 'tier0', label: 'Tier 0', hint: 'The Tier 0 forecast, which includes the promotions of the months it is built from.' }, ...columns]
  ).filter((column) => columnHasValues(column, rows));
  const columnCount = partColumns.length + 4;

  return (
    <section aria-label="Monthly plan" className="space-y-1.5">
      <p className="text-[11px] text-deep-violet-blue/60">
        <span className="font-semibold text-deep-violet-blue">{scope}</span> · Units. Open a month to see how its Tier 0 is
        built.
      </p>
      <div className="@container overflow-x-auto rounded-md border border-lavander">
        <table className="w-full border-separate border-spacing-0 text-xs text-deep-violet-blue">
          <thead>
            <tr>
              {/* px-4: in line with the month cell's chevron (ExpandableRow). */}
              <Header label="Month" className="px-4" />
              <Header label="Last year actual" hint="Sell-out in the same month a year earlier." />
              {partColumns.map((column) => (
                <Header key={column.part} label={column.label} hint={column.hint} />
              ))}
              <Header label="Simulated" hint="The parts added up: the Simulated line on the chart." />
              <Header label="vs last year" hint="Simulated minus last year's actual, and the change as a share of last year's actual." />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cell = 'whitespace-nowrap px-2 py-1.5 text-left align-middle tabular-nums';
              const label = formatMonthLabel(row.month_year);
              const change = row.variance;
              const tone = (value) => (value < 0 ? 'text-red-700' : 'text-emerald-700');
              const isOpen = expanded.isExpanded(row.month_year);
              return (
                <ExpandableRow
                  key={row.month_year}
                  columnCount={columnCount}
                  isOpen={isOpen}
                  onToggle={() => expanded.toggle(row.month_year)}
                  toggleLabel={isOpen ? `Hide how ${label} is built` : `Show how ${label} is built`}
                  wrapPrimary
                  primary={
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span className="whitespace-nowrap">{label}</span>
                      {flagged(row.month_year) ? <StatusPill tone="warning">Big change</StatusPill> : null}
                    </span>
                  }
                  details={detailsFor(row.month_year)}
                >
                  <td className={cell}>
                    {row.lastYear ? (
                      <span className="font-semibold">{units(row.lastYear.units)}</span>
                    ) : (
                      <span className="text-deep-violet-blue/45">{lastYearLoading ? '…' : 'No sales'}</span>
                    )}
                  </td>
                  {partColumns.map((column) => (
                    <PartCell key={column.part} column={column} row={row} cell={cell} onOpenItem={onOpenItem} month={label} />
                  ))}
                  <td className={cell}>
                    <span className="font-semibold text-scenario-ink">{units(row.adjusted.units)}</span>
                  </td>
                  <td className={cell}>
                    {change ? (
                      <>
                        <span className={cn('block font-semibold', tone(change.units))}>{signed(change.units, units)}</span>
                        <span className={cn('block text-[11px]', tone(change.units))}>{percent(change.unitsPct)}</span>
                      </>
                    ) : (
                      <span className="text-deep-violet-blue/45">{lastYearLoading ? '…' : '—'}</span>
                    )}
                  </td>
                </ExpandableRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// One part of a month. The baseline (or Tier 0) is a level; every other part
// is signed, and building blocks list the blocks behind them.
function PartCell({ column, row, cell, onOpenItem, month }) {
  if (column.part === 'promotionLines') {
    return <PromotionsCell lines={row.promotionLines} status={row.planStatus} cell={cell} month={month} />;
  }
  const value = column.part === 'tier0' ? row.model.units : row.parts?.[column.part] ?? (column.part === 'blocks' ? row.blocks.units : 0);
  const level = column.part === 'baseline' || column.part === 'tier0';
  const blockItems = column.part === 'blocks' ? row.items.filter((item) => item.source === 'blocks') : [];
  const empty = !level && !Math.round(value) && !blockItems.length;
  return (
    // Chips open a block in the panel; the click must not also open the month.
    <td className={cell} onClick={blockItems.length ? (event) => event.stopPropagation() : undefined}>
      {empty ? (
        <span className="text-deep-violet-blue/45">—</span>
      ) : (
        <>
          <span className={cn('block font-semibold', !level && 'text-scenario-ink')}>
            {level ? units(value) : signed(value, units)}
          </span>
          {blockItems.length ? <BlockLinks items={blockItems} onOpen={onOpenItem} /> : null}
        </>
      )}
    </td>
  );
}

const LINE_TAGS = { carried: "Last year's", official: 'Planned' };

// Where something is still to plan, a button to the Promotions page.
function PlanLink({ status, month }) {
  if (status !== 'not_planned' && status !== 'partly') return null;
  return (
    <Link
      href="/promotions"
      // The row opens on a click; following the link must not open it too.
      onClick={(event) => event.stopPropagation()}
      title={`${month} still carries last year's promotions. Plan a promotion for it on the Promotions page.`}
      className={cn(buttonVariants({ size: 'xs' }), 'mt-1.5')}
    >
      <Plus data-icon="inline-start" aria-hidden="true" />
      {status === 'partly' ? 'Plan the rest' : 'Plan promotion'}
    </Link>
  );
}

// The Promotions column: one block per kind in the month (last year's, the
// official ones planned, or both when only some SKUs are planned), each a
// figure and its mechanics as pills under where they come from.
function PromotionsCell({ lines, status, cell, month }) {
  if (!lines.length) {
    return (
      <td className={cell}>
        <span className="text-deep-violet-blue/45">—</span>
      </td>
    );
  }
  return (
    // A set width, so the pills wrap instead of taking the room every header needs.
    <td className={cn(cell, 'w-[17rem] min-w-[11rem] whitespace-normal')}>
      <div className="space-y-2">
        {lines.map((line) => (
          <div key={line.kind}>
            <p className="flex items-baseline gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-deep-violet-blue/55">{LINE_TAGS[line.kind]}</span>
              <span className="font-semibold text-scenario-ink">{signed(line.units, units)}</span>
            </p>
            {line.groups.map((group) => (
              <div key={group.kind} className="mt-1">
                {group.kind === 'planned' ? null : (
                  <p className="mb-0.5 text-[10px] text-deep-violet-blue/55">
                    {PROMOTION_SOURCE_LABELS[group.kind]} ({monthSpan(group.months)})
                  </p>
                )}
                <MechanicPills kind={group.kind} mechanics={group.mechanics} />
              </div>
            ))}
            {line.kind === 'carried' ? <PlanLink status={status} month={month} /> : null}
          </div>
        ))}
      </div>
    </td>
  );
}
