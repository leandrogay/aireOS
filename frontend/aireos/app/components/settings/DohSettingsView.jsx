'use client';

import { useState } from 'react';

import { cardClass } from '@/components/inventory/formStyles';
import RefreshButton from '@/components/ui/RefreshButton';
import Toast from '@/components/ui/Toast';
import useDohSettings from '@/hooks/useDohSettings';
import useToast from '@/hooks/useToast';
import { setDohAlert } from '@/app/services/settingsApi';
import { GLOBAL_DEFAULT_DOH } from '@/app/utils/dohSettingsForm';
import { retailerLabel } from '@/app/utils/retailerLabel';

import DohSettingsTable from './DohSettingsTable';
import DohThresholdForm from './DohThresholdForm';

/**
 * The DOH Settings page: every customer's current thresholds and alert
 * toggle, and an edit form (opened from a row) to change one customer's
 * thresholds or reset them to the global default. Each write returns the
 * customer's new settings row, which replaces that row in place; the refresh
 * button refetches everything.
 */
export default function DohSettingsView() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, replaceRow } = useDohSettings({ refreshKey });
  const [editingId, setEditingId] = useState(null);
  const [pendingAlerts, setPendingAlerts] = useState({});
  const { toast, notify, dismissToast } = useToast();

  function handleEdit(row) {
    setEditingId(row.customer_id);
  }

  function handleSaved(result) {
    replaceRow(result.settings);
    setEditingId(null);
    if (!result.changed) {
      notify('success', 'No changes to save: the thresholds are already set to these values');
    } else if (result.settings.is_global_default) {
      // Saved the default values, e.g. after "Restore defaults" in the form.
      notify('success', `Thresholds for ${retailerLabel(result.settings.customer_name)} reset to the global default`);
    } else {
      notify('success', 'Thresholds updated successfully');
    }
  }

  async function handleToggleAlert(row, enabled) {
    const customerId = row.customer_id;
    setPendingAlerts((current) => ({ ...current, [customerId]: enabled }));
    try {
      const result = await setDohAlert(customerId, { doh_alert_enabled: enabled });
      replaceRow(result.settings);
      notify('success', `DOH alerts turned ${enabled ? 'on' : 'off'} for ${retailerLabel(row.customer_name)}`);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setPendingAlerts((current) => {
        const next = { ...current };
        delete next[customerId];
        return next;
      });
    }
  }

  const editingRow = data.find((row) => row.customer_id === editingId);

  return (
    <div className="grid gap-2">
      <section className={cardClass}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-deep-violet-blue">Customer DOH thresholds</h2>
          <RefreshButton
            onClick={() => setRefreshKey((key) => key + 1)}
            isRefreshing={loading}
            label="Refresh DOH settings"
          />
        </div>

        {error && (
          <p className="mb-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {loading && data.length === 0 ? (
          <p className="text-sm text-deep-violet-blue/70">Loading DOH settings…</p>
        ) : data.length === 0 ? (
          !error && <p className="text-sm text-deep-violet-blue/70">No customers found.</p>
        ) : (
          <DohSettingsTable
            rows={data}
            editingId={editingId}
            pendingAlerts={pendingAlerts}
            onEdit={handleEdit}
            onToggleAlert={handleToggleAlert}
          />
        )}

        <p className="mt-2 text-xs text-deep-violet-blue/60">
          Customers without thresholds of their own use the Global Default. 
        </p>
      </section>

      {editingRow && (
        <DohThresholdForm
          key={editingRow.customer_id}
          settings={editingRow}
          onSaved={handleSaved}
          onCancel={() => setEditingId(null)}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
