'use client';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { formatDohDays, formatTimestamp } from '@/app/utils/dohSettingsForm';
import { cn } from '@/lib/utils';

const thClass = 'bg-lavander px-2 py-1.5 text-left text-xs font-semibold text-deep-violet-blue';
const tdClass = 'px-2 py-1.5 text-sm text-deep-violet-blue';
const numClass = 'text-right tabular-nums';

// Brand colours instead of the shadcn default (near-black `primary`), the
// same override InventoryTabs uses for its active tab.
const switchClass = 'data-checked:bg-deep-violet-blue data-unchecked:bg-lavander';

/**
 * One row per customer: min / target / max DOH, when the thresholds were last
 * saved, the alert toggle, and Edit / Reset actions. Rows on the global
 * default are badged and have no Reset. Holds no state of its own; the parent
 * (DohSettingsView) owns editing, confirmation and pending requests.
 *
 * @param {object} props
 * @param {object[]} props.rows settings rows from getDohSettings
 * @param {number | null} props.editingId customer whose form is open
 * @param {Record<number, boolean>} props.pendingAlerts customer_id -> value being saved
 * @param {number | null} props.confirmingResetId customer asked to confirm a reset
 * @param {number | null} props.resettingId customer whose reset is in flight
 * @param {(row: object) => void} props.onEdit
 * @param {(row: object, enabled: boolean) => void} props.onToggleAlert
 * @param {(row: object | null) => void} props.onAskReset null cancels
 * @param {(row: object) => void} props.onConfirmReset
 */
export default function DohSettingsTable({
  rows,
  editingId,
  pendingAlerts,
  confirmingResetId,
  resettingId,
  onEdit,
  onToggleAlert,
  onAskReset,
  onConfirmReset,
}) {
  return (
    <div className="overflow-auto rounded-md border border-lavander">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={thClass}>Customer</th>
            <th className={cn(thClass, numClass)}>Min DOH</th>
            <th className={cn(thClass, numClass)}>Target DOH</th>
            <th className={cn(thClass, numClass)}>Max DOH</th>
            <th className={thClass}>Last updated</th>
            <th className={thClass}>Alerts</th>
            <th className={thClass}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const alertPending = row.customer_id in pendingAlerts;
            const alertOn = alertPending ? pendingAlerts[row.customer_id] : row.doh_alert_enabled;
            const resetting = resettingId === row.customer_id;

            return (
              <tr
                key={row.customer_id}
                className={cn('border-t border-lavander', editingId === row.customer_id && 'bg-cream')}
              >
                <td className={tdClass}>
                  <span className="font-medium">{row.customer_name}</span>
                  {row.is_global_default && (
                    <span className="ml-2 whitespace-nowrap rounded-full border border-violet bg-lavander px-2 py-0.5 text-[11px]">
                      Global Default
                    </span>
                  )}
                </td>
                <td className={cn(tdClass, numClass)}>{formatDohDays(row.min_doh)}</td>
                <td className={cn(tdClass, numClass)}>{formatDohDays(row.target_doh)}</td>
                <td className={cn(tdClass, numClass)}>{formatDohDays(row.max_doh)}</td>
                <td className={cn(tdClass, 'whitespace-nowrap')}>{formatTimestamp(row.thresholds_updated_at)}</td>
                <td className={tdClass}>
                  <div className="inline-flex items-center gap-2">
                    <Switch
                      checked={alertOn}
                      disabled={alertPending}
                      onCheckedChange={(checked) => onToggleAlert(row, checked)}
                      aria-label={`DOH alerts for ${row.customer_name}`}
                      className={switchClass}
                    />
                    <span className="text-xs" aria-hidden="true">
                      {alertOn ? 'On' : 'Off'}
                    </span>
                  </div>
                </td>
                <td className={tdClass}>
                  <div className="flex justify-end gap-1">
                    <Button variant="outline" size="xs" onClick={() => onEdit(row)}>
                      Edit
                    </Button>
                    {!row.is_global_default &&
                      (confirmingResetId === row.customer_id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="xs"
                            disabled={resetting}
                            onClick={() => onConfirmReset(row)}
                          >
                            {resetting ? 'Resetting…' : 'Confirm reset'}
                          </Button>
                          <Button variant="outline" size="xs" disabled={resetting} onClick={() => onAskReset(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="xs" onClick={() => onAskReset(row)}>
                          Reset to default
                        </Button>
                      ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
