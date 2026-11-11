'use client';

import { useState } from 'react';

import RefreshButton from '@/components/ui/RefreshButton';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader from '@/components/ui/TableCardHeader';
import Toast from '@/components/ui/Toast';
import useDohSettings from '@/hooks/useDohSettings';
import useToast from '@/hooks/useToast';
import { setDohAlert } from '@/app/services/settingsApi';
import { GLOBAL_DEFAULT_DOH } from '@/app/utils/dohSettingsForm';
import { customerLabel } from '@/app/utils/retailerLabel';

import DohSettingsTable from './DohSettingsTable';
import DohThresholdForm from './DohThresholdForm';

/**
 * The DOH Settings page: every customer's current thresholds and alert
 * toggle, and an edit dialog (opened from a row) to change one customer's
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
      notify('success', 'No changes to save');
    } else if (result.settings.is_global_default) {
      // Saved the default values, e.g. after "Restore defaults" in the form.
      notify('success', `${customerLabel(result.settings.customer_name)} reset to default`);
    } else {
      notify('success', 'Thresholds updated');
    }
  }

  async function handleToggleAlert(row, enabled) {
    const customerId = row.customer_id;
    setPendingAlerts((current) => ({ ...current, [customerId]: enabled }));
    try {
      const result = await setDohAlert(customerId, { doh_alert_enabled: enabled });
      replaceRow(result.settings);
      notify('success', `DOH alerts ${enabled ? 'on' : 'off'} for ${customerLabel(row.customer_name)}`);
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
    <div className="grid min-w-0 gap-3">
      <TableCard
        variant="glass"
        label="Customer DOH thresholds"
        header={(
          <TableCardHeader
            title="Customer DOH thresholds"
            detail={loading && data.length === 0 ? 'Loading customers…' : `${data.length} ${data.length === 1 ? 'customer' : 'customers'} · Customers without thresholds of their own use the Global Default.`}
            actions={<RefreshButton onClick={() => setRefreshKey((key) => key + 1)} isRefreshing={loading} label="Refresh DOH settings" />}
          />
        )}
      >

        {error && (
          <p className="px-4 pb-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {!loading && data.length === 0 ? (
          !error && <p className="px-4 pb-4 text-sm text-deep-violet-blue/70">No customers found.</p>
        ) : (
          <DohSettingsTable
            rows={data}
            loading={loading && data.length === 0}
            editingId={editingId}
            pendingAlerts={pendingAlerts}
            onEdit={handleEdit}
            onToggleAlert={handleToggleAlert}
          />
        )}

      </TableCard>

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
