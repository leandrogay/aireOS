'use client';

import { Pencil } from 'lucide-react';

import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RowActions from '@/components/ui/RowActions';
import TableGrid, { ACTIONS_COLUMN } from '@/components/ui/TableGrid';
import { formatDateTime } from '@/lib/formatDate';
import { changedByLabel } from '@/app/utils/promoUpliftSettings';
import { cn } from '@/lib/utils';

const COLUMNS = [
  { key: 'mechanic', label: 'Mechanic' },
  { key: 'discount', label: 'Discount', width: '7rem', align: 'right' },
  { key: 'changed', label: 'Last changed', width: '16rem' },
  ACTIONS_COLUMN,
];

const rowClass = 'h-11 cursor-pointer border-b border-lavander/80 last:border-b-0 hover:bg-cream/60';
const tdClass = 'px-4 py-2.5';

/**
 * Every mechanic and its effective discount (the all-customers uplift rows,
 * backend promo_uplifts.list_settings), which the placeholder rule and
 * anchors use. The discount is the one thing edited here: a row, or Edit
 * discount in its "..." menu, opens PromoMechanicDiscountForm.
 *
 * @param {object} props
 * @param {object[]} props.mechanics setting rows with scope 'all'
 * @param {string | null} props.editingKey the mechanic being edited
 * @param {boolean} props.readOnly
 * @param {(row: object) => void} props.onEdit
 */
export default function PromoMechanicTable({ mechanics, editingKey, readOnly, onEdit }) {
  function actions(row) {
    return [{
      key: 'edit',
      label: 'Edit discount',
      icon: Pencil,
      onSelect: () => onEdit(row),
      disabledReason: readOnly ? 'View only' : undefined,
    }];
  }

  function changedText(row) {
    return row.changed_at ? `${formatDateTime(row.changed_at)} · ${changedByLabel(row.changed_by)}` : '—';
  }

  return (
    <>
      {/* Phone width: one card per mechanic, as DohSettingsTable does; the table from sm up. */}
      <div className="grid min-w-0 gap-2 sm:hidden">
        {mechanics.length === 0 ? <p className="text-sm text-deep-violet-blue/70">No mechanics yet.</p> : null}
        {mechanics.map((row) => (
          <MobileRecordCard
            key={row.mechanic_key}
            title={row.mechanic_label}
            actions={<RowActions label={`Actions for ${row.mechanic_label}`} actions={actions(row)} />}
            fields={[
              { label: 'Discount', value: row.effective_discount_pct != null ? `${row.effective_discount_pct}%` : '—' },
              { label: 'Last changed', value: changedText(row) },
            ]}
          />
        ))}
      </div>
      <div className="hidden min-w-0 sm:block">
        <TableGrid
          variant="nested"
          columns={COLUMNS}
          minWidth="34rem"
          emptyState={mechanics.length === 0 ? 'No mechanics yet.' : null}
        >
          {mechanics.map((row) => (
            <tr
              key={row.mechanic_key}
              onClick={() => !readOnly && onEdit(row)}
              className={cn(rowClass, readOnly && 'cursor-default', editingKey === row.mechanic_key && 'bg-lavander/90')}
            >
              <td className={cn(tdClass, 'truncate font-medium')} title={row.mechanic_label}>{row.mechanic_label}</td>
              <td className={cn(tdClass, 'text-right tabular-nums')}>
                {row.effective_discount_pct != null ? `${row.effective_discount_pct}%` : '—'}
              </td>
              <td className={cn(tdClass, 'truncate text-deep-violet-blue/70')}>{changedText(row)}</td>
              <td className="px-2 py-1 text-right" onClick={(event) => event.stopPropagation()}>
                <RowActions label={`Actions for ${row.mechanic_label}`} actions={actions(row)} />
              </td>
            </tr>
          ))}
        </TableGrid>
      </div>
    </>
  );
}
