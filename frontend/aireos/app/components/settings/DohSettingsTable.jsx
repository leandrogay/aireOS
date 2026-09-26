'use client';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { formatDohDays } from '@/app/utils/dohSettingsForm';
import { formatDateTime } from '@/lib/formatDate';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

const thClass = 'bg-lavander px-2 py-1.5 text-left text-xs font-semibold text-deep-violet-blue';
const tdClass = 'px-2 py-1.5 text-sm text-deep-violet-blue';
const numClass = 'text-right tabular-nums';

// Brand colours instead of the shadcn default (near-black `primary`), the
// same override InventoryTabs uses for its active tab.
const switchClass = 'data-checked:bg-deep-violet-blue data-unchecked:bg-lavander';

// Same look as the promotions list's Edit button (PromotionList.jsx
// actionButtonClass): filled deep violet, and violet "Editing" on the row
// whose form is open. Applied to the shared Button primitive.
const editButtonClass =
  'h-auto min-w-[4rem] rounded-md px-3 py-1.5 text-xs font-medium shadow-sm transition';
const editIdleClass = 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue hover:opacity-90';
const editActiveClass = 'bg-violet text-deep-violet-blue hover:bg-violet';

/**
 * One row per customer: min / target / max DOH, when the thresholds were last
 * saved, the alert toggle, and Edit. Rows on the global default are badged.
 * Reset to default lives in the edit form (DohThresholdForm). Holds no state
 * of its own; the parent (DohSettingsView) owns editing and pending requests.
 *
 * @param {object} props
 * @param {object[]} props.rows settings rows from getDohSettings
 * @param {number | null} props.editingId customer whose form is open
 * @param {Record<number, boolean>} props.pendingAlerts customer_id -> value being saved
 * @param {(row: object) => void} props.onEdit
 * @param {(row: object, enabled: boolean) => void} props.onToggleAlert
 */
export default function DohSettingsTable({ rows, editingId, pendingAlerts, onEdit, onToggleAlert }) {
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
                  <div className="inline-flex items-center gap-2">
                    <Switch
                      checked={alertOn}
                      disabled={alertPending}
                      onCheckedChange={(checked) => onToggleAlert(row, checked)}
                      aria-label={`DOH alerts for ${retailerLabel(row.customer_name)}`}
                      className={switchClass}
                    />
                    <span className="text-xs" aria-hidden="true">
                      {alertOn ? 'On' : 'Off'}
                    </span>
                  </div>
                </td>
                <td className={tdClass}>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => onEdit(row)}
                      className={cn(editButtonClass, editingId === row.customer_id ? editActiveClass : editIdleClass)}
                    >
                      {editingId === row.customer_id ? 'Editing' : 'Edit'}
                    </Button>
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
