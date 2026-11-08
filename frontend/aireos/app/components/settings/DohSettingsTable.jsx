'use client';

import { Pencil } from 'lucide-react';

import RowActions from '@/components/ui/RowActions';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import TableSkeleton from '@/components/ui/TableSkeleton';
import ToggleField from '@/components/ui/ToggleField';
import { formatDohDays } from '@/app/utils/dohSettingsForm';
import { formatDateTime } from '@/lib/formatDate';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

const thClass = 'bg-cream px-2 py-1.5 text-left text-xs font-medium text-deep-violet-blue/60';
const tdClass = 'px-2 py-1.5 text-sm text-deep-violet-blue';
const numClass = 'text-right tabular-nums';

function editAction(row, editingId, onEdit) {
  return [{
    key: 'edit',
    label: 'Edit thresholds',
    icon: Pencil,
    onSelect: () => onEdit(row),
    disabledReason: editingId === row.customer_id ? 'Editing now' : undefined,
  }];
}

/**
 * One row per customer: min / target / max DOH, when the thresholds were last
 * saved, the alert toggle, and an actions menu. Rows on the global default are badged.
 * Reset to default lives in the edit form (DohThresholdForm). Holds no state
 * of its own; the parent (DohSettingsView) owns editing and pending requests.
 *
 * @param {object} props
 * @param {object[]} props.rows settings rows from getDohSettings
 * @param {number | null} props.editingId customer whose form is open
 * @param {Record<number, boolean>} props.pendingAlerts customer_id -> value being saved
 * @param {(row: object) => void} props.onEdit
 * @param {(row: object, enabled: boolean) => void} props.onToggleAlert
 * @param {boolean} [props.loading] first load in flight: placeholder rows,
 *   sized like the real ones
 */
export default function DohSettingsTable({
  rows,
  editingId,
  pendingAlerts,
  onEdit,
  onToggleAlert,
  loading = false,
}) {
  return (
    <>
    <div className="grid min-w-0 gap-2 sm:hidden">
      {loading && Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="h-28 animate-pulse rounded-lg border border-lavander bg-white" />
      ))}
      {rows.map((row) => {
        const alertPending = row.customer_id in pendingAlerts;
        const alertOn = alertPending ? pendingAlerts[row.customer_id] : row.doh_alert_enabled;
        const customer = retailerLabel(row.customer_name);
        return (
          <MobileRecordCard
            key={row.customer_id}
            title={customer}
            badge={row.is_global_default && (
              <span className="rounded-full border border-violet bg-lavander px-2 py-0.5 text-[10px] text-deep-violet-blue">Global Default</span>
            )}
            actions={<RowActions label={`Actions for DOH settings for ${customer}`} actions={editAction(row, editingId, onEdit)} />}
            fields={[
              { label: 'Min DOH', value: formatDohDays(row.min_doh) },
              { label: 'Target DOH', value: formatDohDays(row.target_doh) },
              { label: 'Max DOH', value: formatDohDays(row.max_doh) },
              { label: 'Last updated', value: formatDateTime(row.thresholds_updated_at) },
              { label: 'Alerts', value: <ToggleField ariaLabel={`DOH alerts for ${customer}`} checked={alertOn} disabled={alertPending} onChange={(checked) => onToggleAlert(row, checked)} /> },
            ]}
          />
        );
      })}
    </div>
    <div className="hidden max-w-full min-w-0 overflow-auto rounded-md border border-lavander sm:block">
      <table className="aire-table-rows w-full min-w-[44rem] border-collapse">
        <thead>
          <tr>
            <th className={thClass}>Customer</th>
            <th className={cn(thClass, numClass)}>Min DOH</th>
            <th className={cn(thClass, numClass)}>Target DOH</th>
            <th className={cn(thClass, numClass)}>Max DOH</th>
            <th className={thClass}>Last updated</th>
            <th className={thClass}>Alerts</th>
            <th className={thClass}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody aria-busy={loading}>
          {loading && (
            <TableSkeleton
              columns={7}
              rows={4}
              className="h-10 border-b-0 border-t border-lavander"
              cellClassName="px-2 py-1.5"
            />
          )}
          {rows.map((row) => {
            const alertPending = row.customer_id in pendingAlerts;
            const alertOn = alertPending ? pendingAlerts[row.customer_id] : row.doh_alert_enabled;

            return (
              <tr
                key={row.customer_id}
                className={cn('border-t border-lavander', editingId === row.customer_id && 'bg-cream')}
              >
                <td className={tdClass}>
                  <span className="font-medium">{retailerLabel(row.customer_name)}</span>
                  {row.is_global_default && (
                    <span className="ml-2 whitespace-nowrap rounded-full border border-violet bg-lavander px-2 py-0.5 text-[11px]">
                      Global Default
                    </span>
                  )}
                </td>
                <td className={cn(tdClass, numClass)}>{formatDohDays(row.min_doh)}</td>
                <td className={cn(tdClass, numClass)}>{formatDohDays(row.target_doh)}</td>
                <td className={cn(tdClass, numClass)}>{formatDohDays(row.max_doh)}</td>
                <td className={cn(tdClass, 'whitespace-nowrap')}>{formatDateTime(row.thresholds_updated_at)}</td>
                <td className={tdClass}>
                  <ToggleField
                    ariaLabel={`DOH alerts for ${retailerLabel(row.customer_name)}`}
                    checked={alertOn}
                    disabled={alertPending}
                    onChange={(checked) => onToggleAlert(row, checked)}
                  />
                </td>
                <td className={cn(tdClass, 'text-right')}>
                  <div className="flex justify-end">
                    <RowActions
                      label={`Actions for DOH settings for ${retailerLabel(row.customer_name)}`}
                      actions={editAction(row, editingId, onEdit)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
