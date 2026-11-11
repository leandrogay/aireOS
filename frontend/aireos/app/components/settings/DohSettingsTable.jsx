'use client';

import { Pencil } from 'lucide-react';

import DataTable from '@/components/ui/DataTable';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RecordCardList from '@/components/ui/RecordCardList';
import RowActions from '@/components/ui/RowActions';
import TableRow from '@/components/ui/TableRow';
import ToggleField from '@/components/ui/ToggleField';
import { formatDohDays } from '@/app/utils/dohSettingsForm';
import { customerLabel } from '@/app/utils/retailerLabel';
import { formatDateTime } from '@/lib/formatDate';

import { DOH_COLUMNS } from './dohColumns';

const cellClass = 'px-4 py-2.5';
const numberCellClass = 'px-4 py-2.5 text-right tabular-nums';

function editAction(row, editingId, onEdit) {
  return [{
    key: 'edit',
    label: 'Edit thresholds',
    icon: Pencil,
    onSelect: () => onEdit(row),
    disabledReason: editingId === row.customer_id ? 'Editing now' : undefined,
  }];
}

// The alert value shown while its save is in flight is the one being saved.
function alertState(row, pendingAlerts) {
  const pending = row.customer_id in pendingAlerts;
  return { pending, on: pending ? pendingAlerts[row.customer_id] : row.doh_alert_enabled };
}

/**
 * One row per customer in the shared list table (DataTable): min / target /
 * max DOH, when the thresholds were last saved, the alert toggle, and an
 * actions menu. Whether a customer is on the global default is shown in the
 * edit dialog's badge, not here; Reset to default lives in the edit form
 * (DohThresholdForm). Holds no state of its own; the parent (DohSettingsView)
 * owns editing and pending requests. The row being edited is highlighted.
 *
 * @param {{
 *   rows: object[],
 *   loading: boolean,
 *   error: string | null,
 *   editingId: number | null,
 *   pendingAlerts: Record<number, boolean>,
 *   onEdit: (row: object) => void,
 *   onToggleAlert: (row: object, enabled: boolean) => void,
 *   onRefresh: () => void,
 * }} props
 */
export default function DohSettingsTable({
  rows,
  loading,
  error,
  editingId,
  pendingAlerts,
  onEdit,
  onToggleAlert,
  onRefresh,
}) {
  return (
    <DataTable
      label="Customer DOH thresholds"
      noun="customer"
      totalCount={rows.length}
      isLoading={loading}
      error={error}
      onRefresh={onRefresh}
      emptyMessage="No customers yet. Add one on the Customers page to set its DOH thresholds."
      columns={DOH_COLUMNS}
      minWidth="44rem"
      skeletonRows={4}
      mobileContent={
        <RecordCardList>
          {rows.map((row) => {
            const customer = customerLabel(row.customer_name);
            const alert = alertState(row, pendingAlerts);
            return (
              <MobileRecordCard
                key={row.customer_id}
                title={customer}
                actions={<RowActions label={`Actions for DOH settings for ${customer}`} actions={editAction(row, editingId, onEdit)} />}
                fields={[
                  { label: 'Min DOH', value: formatDohDays(row.min_doh) },
                  { label: 'Target DOH', value: formatDohDays(row.target_doh) },
                  { label: 'Max DOH', value: formatDohDays(row.max_doh) },
                  { label: 'Last updated', value: formatDateTime(row.thresholds_updated_at) },
                  { label: 'Alerts', value: <ToggleField ariaLabel={`DOH alerts for ${customer}`} checked={alert.on} disabled={alert.pending} onChange={(checked) => onToggleAlert(row, checked)} /> },
                ]}
              />
            );
          })}
        </RecordCardList>
      }
    >
      {rows.map((row) => {
        const customer = customerLabel(row.customer_name);
        const alert = alertState(row, pendingAlerts);
        return (
          <TableRow
            key={row.customer_id}
            data-highlight={editingId === row.customer_id ? 'editing' : undefined}
            className="h-12 border-b border-lavander/80"
          >
            <td className="truncate px-4 py-2.5 font-medium" title={customer}>{customer}</td>
            <td className={numberCellClass}>{formatDohDays(row.min_doh)}</td>
            <td className={numberCellClass}>{formatDohDays(row.target_doh)}</td>
            <td className={numberCellClass}>{formatDohDays(row.max_doh)}</td>
            <td className={cellClass}>{formatDateTime(row.thresholds_updated_at)}</td>
            <td className={cellClass}>
              <ToggleField
                ariaLabel={`DOH alerts for ${customer}`}
                checked={alert.on}
                disabled={alert.pending}
                onChange={(checked) => onToggleAlert(row, checked)}
              />
            </td>
            <td className="px-2 py-1.5 text-right">
              <RowActions label={`Actions for DOH settings for ${customer}`} actions={editAction(row, editingId, onEdit)} />
            </td>
          </TableRow>
        );
      })}
    </DataTable>
  );
}
