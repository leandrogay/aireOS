'use client';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import { formatMonthLabel } from '@/app/utils/forecastView';

function units(value) {
  return Math.round(value).toLocaleString('en-US');
}

function signed(value, format) {
  return `${value < 0 ? '−' : '+'}${format(Math.abs(value))}`;
}

function percent(share) {
  return share == null ? '—' : `${share < 0 ? '−' : '+'}${Math.abs(share * 100).toFixed(1)}%`;
}

// A column heading with its explanation behind an info button; TableGrid
// draws the <th> around it.
function HintLabel({ label, hint }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTooltip label={`About ${label}`}>{hint}</InfoTooltip>
    </span>
  );
}

const COLUMNS = [
  { key: 'month', label: 'Month', width: '7rem' },
  {
    key: 'lastYear',
    label: <HintLabel label="Last year actual" hint="Sell-out in the same month a year earlier." />,
    align: 'right',
  },
  {
    key: 'model',
    label: <HintLabel label="Model forecast" hint="The Current forecast line, before any building blocks." />,
    align: 'right',
  },
  {
    key: 'blocks',
    label: <HintLabel label="Building blocks" hint="What the switched-on building blocks add this month." />,
    align: 'right',
  },
  {
    key: 'adjusted',
    label: (
      <HintLabel
        label="Adjusted forecast"
        hint="Model forecast plus building blocks: the Simulated line on the chart."
      />
    ),
    align: 'right',
  },
  {
    key: 'variance',
    label: <HintLabel label="vs last year" hint="Adjusted forecast minus last year's actual." />,
    align: 'right',
  },
  {
    key: 'variancePct',
    label: <HintLabel label="%" hint="The change against last year as a share of last year's actual." />,
    width: '6rem',
    align: 'right',
  },
];

const CELL_CLASS = 'px-3 py-2 align-top';
const NUMBER_CELL_CLASS = 'px-3 py-2 text-right align-top tabular-nums';

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

/**
 * The Scenario builder's monthly plan for the filters' scope, on the shared
 * TableGrid: one row per forecast month with Last year actual, Model
 * forecast, Building blocks and Adjusted forecast in units, and the variance
 * against last year. Months a switched-on block changes are tinted
 * (`data-highlight="scenario"`, globals.css) with a scenario rule on their
 * left edge, and a block's name opens it in the panel (new blocks are added
 * there). All numbers come from scenarioPlan.buildPlanRows.
 *
 * @param {{
 *   rows: ReturnType<typeof import('@/app/utils/scenarioPlan').buildPlanRows>,
 *   lastYearLoading: boolean,
 *   onOpenItem: (itemId: string) => void,
 *   scope: string,
 * }} props
 */
export default function MonthlyPlanTable({ rows, lastYearLoading, onOpenItem, scope }) {
  if (!rows.length) {
    return (
      <p className="rounded-md border border-lavander bg-white px-3 py-3 text-xs text-deep-violet-blue/60">
        No forecast months in this period. Pick a period that reaches into the forecast to plan building blocks.
      </p>
    );
  }

  const pending = <span className="text-deep-violet-blue/45">{lastYearLoading ? '…' : '—'}</span>;
  const tone = (value) => (value < 0 ? 'text-red-700' : 'text-emerald-700');

  return (
    <section aria-label="Monthly plan" className="space-y-1.5">
      <p className="text-[11px] text-deep-violet-blue/60">
        <span className="font-semibold text-deep-violet-blue">{scope}</span> · Units.
        Shaded months have a switched-on building block.
      </p>
      <TableGrid variant="nested" columns={COLUMNS} minWidth="52rem">
        {rows.map((row) => {
          const marked = row.items.length > 0;
          const change = row.variance;
          return (
            <TableRow
              key={row.month_year}
              data-highlight={marked ? 'scenario' : undefined}
              className="border-b border-lavander/80 last:border-b-0"
            >
              <td
                className={cn(
                  CELL_CLASS,
                  'font-medium',
                  marked && 'shadow-[inset_3px_0_0_var(--color-scenario)]'
                )}
              >
                {formatMonthLabel(row.month_year)}
              </td>
              <td className={NUMBER_CELL_CLASS}>
                {row.lastYear ? (
                  units(row.lastYear.units)
                ) : (
                  <span className="text-deep-violet-blue/45">{lastYearLoading ? '…' : 'No sales'}</span>
                )}
              </td>
              <td className={NUMBER_CELL_CLASS}>{units(row.model.units)}</td>
              <td className={NUMBER_CELL_CLASS}>
                {marked ? (
                  <>
                    <span className="block font-semibold text-scenario-ink">{signed(row.blocks.units, units)}</span>
                    <BlockLinks items={row.items} onOpen={onOpenItem} />
                  </>
                ) : (
                  <span className="text-deep-violet-blue/45">—</span>
                )}
              </td>
              <td className={cn(NUMBER_CELL_CLASS, 'font-medium', marked && 'font-semibold text-scenario-ink')}>
                {units(row.adjusted.units)}
              </td>
              <td className={cn(NUMBER_CELL_CLASS, change && cn('font-semibold', tone(change.units)))}>
                {change ? signed(change.units, units) : pending}
              </td>
              <td className={cn(NUMBER_CELL_CLASS, change && cn('font-semibold', tone(change.units)))}>
                {change ? percent(change.unitsPct) : pending}
              </td>
            </TableRow>
          );
        })}
      </TableGrid>
    </section>
  );
}
