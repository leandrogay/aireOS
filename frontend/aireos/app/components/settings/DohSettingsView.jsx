'use client';

import { useCallback, useState } from 'react';

import InventoryToast from '@/components/inventory/InventoryToast';
import { cardClass } from '@/components/inventory/formStyles';
import RefreshButton from '@/components/ui/RefreshButton';
import useDohSettings from '@/hooks/useDohSettings';
import { resetDohThresholds, setDohAlert } from '@/app/services/settingsApi';
import { GLOBAL_DEFAULT_DOH } from '@/app/utils/dohSettingsForm';

import DohSettingsTable from './DohSettingsTable';
import DohThresholdForm from './DohThresholdForm';

/**
 * The DOH Settings page: every customer's current thresholds and alert
 * toggle, a form to change one customer's thresholds, and reset to the global
 * default. Each write returns the customer's new settings row, which replaces
 * that row in place; the refresh button refetches everything.
 */
export default function DohSettingsView() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error, replaceRow } = useDohSettings({ refreshKey });
  const [editingId, setEditingId] = useState(null);
  const [confirmingResetId, setConfirmingResetId] = useState(null);
  const [resettingId, setResettingId] = useState(null);
  const [pendingAlerts, setPendingAlerts] = useState({});
  const [toast, setToast] = useState(null);

  // InventoryToast lists onDismiss in its effect, so it needs a stable identity.
  const dismissToast = useCallback(() => setToast(null), []);

  function notify(type, message) {
    setToast({ id: Date.now(), type, message });
  }

  function handleEdit(row) {
    setConfirmingResetId(null);
    setEditingId(row.customer_id);
  }

  function handleSaved(result) {
    replaceRow(result.settings);
    setEditingId(null);
    notify(
      'success',
      result.changed ? 'Thresholds updated successfully' : 'No changes to save: the thresholds are already set to these values',
    );
  }

  async function handleToggleAlert(row, enabled) {
    const customerId = row.customer_id;
    setPendingAlerts((current) => ({ ...current, [customerId]: enabled }));
    try {
      const result = await setDohAlert(customerId, { doh_alert_enabled: enabled });
      replaceRow(result.settings);
      notify('success', `DOH alerts turned ${enabled ? 'on' : 'off'} for ${row.customer_name}`);
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

  async function handleConfirmReset(row) {
    setResettingId(row.customer_id);
    try {
      const result = await resetDohThresholds(row.customer_id);
      replaceRow(result.settings);
      setConfirmingResetId(null);
      if (editingId === row.customer_id) setEditingId(null);
      notify('success', `Thresholds for ${row.customer_name} reset to the global default`);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setResettingId(null);
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
            confirmingResetId={confirmingResetId}
            resettingId={resettingId}
            onEdit={handleEdit}
            onToggleAlert={handleToggleAlert}
            onAskReset={(row) => setConfirmingResetId(row ? row.customer_id : null)}
            onConfirmReset={handleConfirmReset}
          />
        )}

        <p className="mt-2 text-xs text-deep-violet-blue/60">
          Customers without thresholds of their own use the Global Default: target {GLOBAL_DEFAULT_DOH.target}{' '}
          days, min {GLOBAL_DEFAULT_DOH.min} and max {GLOBAL_DEFAULT_DOH.max} (target ±5). Last updated is when
          the thresholds were last saved.
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

      <InventoryToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
