'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import { monthlyContributions } from '@/app/utils/scenarioTableView';
import MechanicPills, { PROMOTION_SOURCE_LABELS, monthSpan } from './MechanicPills';

const COLUMNS = [
  { key: 'part', label: 'Part', width: '12rem' },
  { key: 'units', label: 'Units', width: '8rem' },
  { key: 'details', label: 'Details' },
];
const STATE_LABELS = { draft: 'Draft', edited: 'Unsaved edits' };
const cellClass = 'px-4 py-2.5 text-left align-top';

function units(value) {
  return Math.round(value).toLocaleString('en-US');
}

function PromotionDetails({ line, status, month, allowOfficialPlanning }) {
  return (
    <div className="space-y-2">
      {line.groups.map((group) => (
        <div key={group.kind}>
          <p className="mb-1 text-xs text-deep-violet-blue/60">
            {PROMOTION_SOURCE_LABELS[group.kind]}{group.months.length ? ` (${monthSpan(group.months)})` : ''}
          </p>
          <MechanicPills kind={group.kind} mechanics={group.mechanics} wrap />
        </div>
      ))}
      {allowOfficialPlanning && line.kind === 'carried' && (status === 'not_planned' || status === 'partly') ? (
        <Link href="/promotions" className={buttonVariants({ size: 'xs' })}
          title={`Plan an official promotion for ${month}`}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          {status === 'partly' ? 'Plan the rest' : 'Plan promotion'}
        </Link>
      ) : null}
    </div>
  );
}

function ItemDetails({ items, onOpenItem }) {
  if (!items?.length) return <span className="text-deep-violet-blue/45">—</span>;
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.itemId} className="flex flex-wrap items-center gap-2">
          {item.source === 'blocks' ? (
            <button type="button" onClick={() => onOpenItem(item.itemId)}
              className="whitespace-normal text-left font-medium text-scenario-ink underline decoration-dotted underline-offset-4 hover:decoration-solid">
              {item.name}
            </button>
          ) : <span className="whitespace-normal">{item.name}</span>}
          {STATE_LABELS[item.state] ? <StatusPill tone="info">{STATE_LABELS[item.state]}</StatusPill> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The contribution table and Tier 0 explanation inside an opened month.
 * @param {{ row: object, split: boolean, baseLabel: string, month: string, flagged: boolean,
 *   onOpenItem: (id: string) => void, children: import('react').ReactNode, allowOfficialPlanning?: boolean }} props
 */
export default function MonthlyPlanDetails({ row, split, baseLabel, month, flagged, onOpenItem, children, allowOfficialPlanning = true }) {
  const contributions = monthlyContributions(row, { split, baseLabel });
  return (
    <div className="space-y-4 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-deep-violet-blue">{month} · contributions</h3>
        {flagged ? <StatusPill tone="warning">Big change</StatusPill> : null}
      </div>
      <TableGrid variant="nested" columns={COLUMNS} minWidth="38rem">
        {contributions.map((part) => (
          <TableRow key={part.key}>
            <td className={cn(cellClass, 'whitespace-normal')}>{part.label}</td>
            <td className={cn(cellClass, 'font-medium tabular-nums', !part.level && 'text-scenario-ink')}>
              {part.level ? units(part.units) : `${part.units < 0 ? '−' : '+'}${units(Math.abs(part.units))}`}
            </td>
            <td className={cn(cellClass, 'whitespace-normal')}>
              {part.line ? <PromotionDetails line={part.line} status={row.planStatus} month={month} allowOfficialPlanning={allowOfficialPlanning} />
                : <ItemDetails items={part.items} onOpenItem={onOpenItem} />}
            </td>
          </TableRow>
        ))}
        <TableRow key="total" className="font-semibold">
          <td className={cellClass}>Simulated</td>
          <td className={cn(cellClass, 'tabular-nums text-scenario-ink')}>{units(row.adjusted.units)}</td>
          <td className={cellClass} />
        </TableRow>
      </TableGrid>
      {children}
    </div>
  );
}
