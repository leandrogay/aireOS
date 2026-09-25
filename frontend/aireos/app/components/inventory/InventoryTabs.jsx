'use client';

import { useCallback, useState } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import useInventoryOptions from '@/hooks/useInventoryOptions';

import AtRiskView from './AtRiskView';
import CustomerInventoryView from './CustomerInventoryView';
import DohThresholdsPanel from './DohThresholdsPanel';
import InventoryDataManager from './InventoryDataManager';
import InventoryOverview from './InventoryOverview';
import InventoryToast from './InventoryToast';
import SellInPlanView from './SellInPlanView';

const TAB_TRIGGER_CLASS =
  'text-deep-violet-blue/70 hover:text-deep-violet-blue data-active:bg-deep-violet-blue data-active:text-white';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'customer', label: 'By customer' },
  { value: 'risk', label: 'At risk' },
  { value: 'plan', label: 'Sell-in plan' },
  { value: 'manage', label: 'Enter / edit data' },
  { value: 'thresholds', label: 'DOH thresholds' },
];

/**
 * The inventory page: overall view for all customers, one customer with DOH,
 * the at-risk list, the sell-in plan, the create/edit form, and DOH thresholds. Only the active tab is mounted, so
 * switching tabs refetches, and `refreshKey` (bumped after any write) makes the
 * mounted views refetch too. Table rows' Edit buttons jump to the form.
 */
export default function InventoryTabs() {
  const options = useInventoryOptions();
  const [tab, setTab] = useState('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const [editRow, setEditRow] = useState(null);
  const [toast, setToast] = useState(null);

  const dismissToast = useCallback(() => setToast(null), []);

  function notify(type, message) {
    setToast({ id: Date.now(), type, message });
  }

  function handleTabChange(value) {
    setTab(value);
    setEditRow(null);
  }

  function handleEditRow(row) {
    setEditRow(row);
    setTab('manage');
  }

  function handleRecordSaved(message) {
    setRefreshKey((key) => key + 1);
    setEditRow(null);
    notify('success', message);
  }

  const skuOptions = options.skus;

  return (
    <div>
      <Tabs value={tab} onValueChange={handleTabChange} className="mb-3">
        <TabsList className="bg-lavander">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className={TAB_TRIGGER_CLASS}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {options.error && (
        <p className="mb-2 text-sm text-red-600" role="alert">
          {options.error}
        </p>
      )}

      {tab === 'overview' && (
        <InventoryOverview skuOptions={skuOptions} refreshKey={refreshKey} onEditRow={handleEditRow} />
      )}

      {tab === 'customer' && (
        <CustomerInventoryView
          customers={options.customers}
          skuOptions={skuOptions}
          refreshKey={refreshKey}
          onEditRow={handleEditRow}
        />
      )}

      {tab === 'risk' && <AtRiskView customers={options.customers} refreshKey={refreshKey} />}

      {tab === 'plan' && <SellInPlanView customers={options.customers} refreshKey={refreshKey} />}

      {tab === 'manage' && (
        <InventoryDataManager
          key={editRow ? `${editRow.customer_id}-${editRow.sku}-${editRow.month}` : 'blank'}
          customers={options.customers}
          skus={options.skus}
          editRow={editRow}
          onSaved={handleRecordSaved}
        />
      )}

      {tab === 'thresholds' && (
        <DohThresholdsPanel
          customers={options.customers}
          refreshKey={refreshKey}
          onChanged={() => setRefreshKey((key) => key + 1)}
          onNotify={notify}
        />
      )}

      <InventoryToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
