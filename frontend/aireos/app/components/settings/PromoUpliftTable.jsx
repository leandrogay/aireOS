'use client';

import { ArchiveRestore, FileSearch, FolderArchive, History, Pencil, RotateCcw } from 'lucide-react';

import RowActions from '@/components/ui/RowActions';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid from '@/components/ui/TableGrid';
import { formatDateTime } from '@/lib/formatDate';
import {
  cappedNote,
  changedByLabel,
  mechanicKind,
  scopeLabel,
  shownUplift,
  shownUpliftCapped,
} from '@/app/utils/promoUpliftSettings';
import { formatPct, sourceLabel } from '@/app/utils/scenarioPromotions';
import { cn } from '@/lib/utils';

import { PROMO_UPLIFT_COLUMNS } from './promoUpliftColumns';

const SOURCE_TAG_CLASS = {
  rule_based: 'border-violet/40 bg-cream',
  estimate: 'border-deep-violet-blue/30 bg-lavander',
  measured: 'border-emerald-600/30 bg-emerald-50',
  learned: 'border-sky-600/30 bg-sky-50',
};

const LEARNED_REASON = 'Set by the forecasting model after each retrain';

/**
 * Every current uplift row: mechanic, effective discount, uplift, who it
 * applies to and where the value came from. Each row's "..." menu has Edit
 * details and History (dialogs the view owns), Reset to the rule for an
 * uplift someone typed, and Archive, which takes it out of use without
 * deleting it. An archived row (shown only with "Show archived") can be
 * restored. Learned rows are set by the model and cannot be edited. Customer
 * and SKU uplifts also have Evidence: the measurement behind them.
 *
 * @param {object} props
 * @param {object[]} props.rows setting rows from getPromoUpliftSettings, already filtered
 * @param {number} props.anchorPct rule-based uplifts are shown at this anchor
 * @param {number} props.rate the rule's rate (% per point)
 * @param {boolean} props.isLoading first load: skeleton rows
 * @param {import('react').ReactNode} props.emptyState shown instead of the rows when there are none
 * @param {boolean} props.readOnly sample values: no actions
 * @param {(row: object) => void} props.onEdit
 * @param {(row: object) => void} props.onHistory
 * @param {(row: object) => void} props.onReset
 * @param {(row: object) => void} props.onArchive
 * @param {(row: object) => void} props.onRestore
 * @param {(row: object) => void} props.onEvidence
 */
export default function PromoUpliftTable({
  rows,
  anchorPct,
  rate,
  isLoading,
  emptyState,
  readOnly,
  onEdit,
  onHistory,
  onReset,
  onArchive,
  onRestore,
  onEvidence,
}) {
  function actionsFor(row) {
    const history = { key: 'history', label: 'History', icon: History, onSelect: () => onHistory(row) };
    if (row.archived_at) {
      return [history, { key: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: () => onRestore(row) }];
    }

    const isLearned = row.source === 'learned';
    const actions = [
      {
        key: 'edit',
        label: 'Edit details',
        icon: Pencil,
        disabledReason: isLearned ? LEARNED_REASON : undefined,
        onSelect: () => onEdit(row),
      },
      history,
    ];
    if (row.scope === 'customer' || row.scope === 'sku') {
      actions.push({ key: 'evidence', label: 'Evidence', icon: FileSearch, onSelect: () => onEvidence(row) });
    }
    if (row.scope === 'all' && row.source !== 'rule_based' && !isLearned) {
      actions.push({ key: 'reset', label: 'Reset to the rule', icon: RotateCcw, onSelect: () => onReset(row) });
    }
    actions.push({
      key: 'archive',
      label: 'Archive',
      icon: FolderArchive,
      destructive: true,
      disabledReason: isLearned ? LEARNED_REASON : undefined,
      onSelect: () => onArchive(row),
    });
    return actions;
  }

  return (
    <TableGrid
      variant="nested"
      columns={PROMO_UPLIFT_COLUMNS}
      minWidth="64rem"
      isLoading={isLoading}
      emptyState={emptyState}
    >
      {rows.map((row) => (
        <tr
          key={row.id}
          className={cn(
            'h-12 border-b border-lavander/80 last:border-b-0 hover:bg-cream/60',
            row.archived_at && 'bg-cream/40 text-deep-violet-blue/60'
          )}
        >
          <td className="truncate px-4 py-2 font-medium" title={row.mechanic_label}>
            {row.mechanic_label}
            {mechanicKind(row) === 'voucher' ? (
              <span className="block text-[10px] font-normal text-deep-violet-blue/50">Voucher</span>
            ) : null}
          </td>
          <td className="px-4 py-2 tabular-nums">
            {row.effective_discount_pct != null ? `${row.effective_discount_pct}%` : '—'}
          </td>
          <td className="px-4 py-2 tabular-nums">
            {formatPct(shownUplift(row, anchorPct, rate))}
            {shownUpliftCapped(row, anchorPct, rate) ? (
              <span className="block text-[10px] text-amber-800">{cappedNote(shownUplift(row, anchorPct, rate))}</span>
            ) : null}
          </td>
          <td className="truncate px-4 py-2" title={scopeLabel(row)}>{scopeLabel(row)}</td>
          <td className="px-4 py-2">
            {row.archived_at ? (
              <StatusPill tone="muted">Archived</StatusPill>
            ) : (
              <span
                className={cn('whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]', SOURCE_TAG_CLASS[row.source])}
                title={row.note ?? undefined}
              >
                {sourceLabel(row.source)}
              </span>
            )}
            {row.source === 'measured' && row.evidence_months != null && !row.archived_at ? (
              <span className="block text-[10px] text-deep-violet-blue/50">{row.evidence_months} months of evidence</span>
            ) : null}
          </td>
          <td className="truncate px-4 py-2 text-xs">
            {row.changed_at
              ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}`
              : changedByLabel(row.changed_by)}
          </td>
          <td className="px-2 py-1 text-right">
            {readOnly ? null : (
              <RowActions label={`Actions for ${row.mechanic_label}, ${scopeLabel(row)}`} actions={actionsFor(row)} />
            )}
          </td>
        </tr>
      ))}
    </TableGrid>
  );
}
