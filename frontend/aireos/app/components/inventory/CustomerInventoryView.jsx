'use client';

import { useState } from 'react';

import useCustomerInventory from '@/hooks/useCustomerInventory';
import { DOH_STATUS_LABELS, formatDoh, monthInputToDate } from '@/app/utils/inventoryForm';

import DohTrendChart from './DohTrendChart';
import InventoryFilters from './InventoryFilters';
import InventorySkuTable from './InventorySkuTable';
import { cardClass, inputClass, labelClass } from './formStyles';

const STATUS_OPTIONS = Object.entries(DOH_STATUS_LABELS).map(([value, label]) => ({ value, label }));

/**
 * One customer's inventory: DOH trend as a line against the customer's target
 * band, and the SKU-level table with ending stock, DOH and the gap to target.
 * Opening and ending stock come from the same derivation as the overview;
 * DOH is derived by the backend from ending stock and forward sell-out
 * (real where it exists, forecast after that).
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {Array<{ sku: string, product_name: string }>} props.skuOptions
 * @param {number} props.refreshKey bumped after a create/edit
 * @param {(row: object) => void} props.onEditRow
 */
export default function CustomerInventoryView({ customers, skuOptions, refreshKey, onEditRow }) {
  const [customerId, setCustomerId] = useState(null);
  const [skus, setSkus] = useState([]);
  const [startMonth, setStartMonth] = useState('');
  const [endMonth, setEndMonth] = useState('');
  const [status, setStatus] = useState('');

  // Adjust state during render: pick the first customer once the list arrives,
  // so the view is never empty by default. Runs only while nothing is chosen.
  if (customerId === null && customers.length > 0) {
    setCustomerId(customers[0].customer_id);
  }

  const { data, loading, error } = useCustomerInventory({
    customerId,
    skus,
    startMonth: monthInputToDate(startMonth),
    endMonth: monthInputToDate(endMonth),
    refreshKey,
  });

  function clearFilters() {
    setSkus([]);
    setStartMonth('');
    setEndMonth('');
    setStatus('');
  }

  const rows = data ? data.skus.filter((row) => !status || row.doh_status === status) : [];
  const threshold = data?.threshold;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="w-56">
          <span className={labelClass}>Customer</span>
          <select
            value={customerId ?? ''}
            onChange={(e) => setCustomerId(Number(e.target.value))}
            className={inputClass}
          >
            {customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.customer_name}
              </option>
            ))}
          </select>
        </label>

        {threshold && (
          <p className="pb-1.5 text-sm text-deep-violet-blue">
            DOH target <strong>{formatDoh(threshold.target_doh)}</strong> days (min{' '}
            {formatDoh(threshold.min_doh)}, max {formatDoh(threshold.max_doh)})
            {threshold.is_global_default && (
              <span className="ml-2 rounded-full border border-violet bg-lavander px-2 py-0.5 text-[11px]">
                Global Default
              </span>
            )}
          </p>
        )}
      </div>

      <InventoryFilters
        skuOptions={skuOptions}
        skus={skus}
        onSkusChange={setSkus}
        startMonth={startMonth}
        endMonth={endMonth}
        onStartMonthChange={setStartMonth}
        onEndMonthChange={setEndMonth}
        status={status}
        onStatusChange={setStatus}
        statusOptions={STATUS_OPTIONS}
        onClear={clearFilters}
      />

      {error && <p className="mb-2 text-sm text-red-600" role="alert">{error}</p>}

      <div className="grid grid-cols-1 gap-2">
        <section className={cardClass}>
          <h2 className="mb-2 text-sm font-medium text-deep-violet-blue">Days of holding (DOH) trend</h2>
          {loading && !data ? (
            <p className="text-sm text-deep-violet-blue/70">Loading inventory…</p>
          ) : (
            data && <DohTrendChart trend={data.trend} />
          )}
        </section>

        <section className={cardClass}>
          <h2 className="mb-2 text-sm font-medium text-deep-violet-blue">Inventory by SKU</h2>
          {loading && !data ? (
            <p className="text-sm text-deep-violet-blue/70">Loading inventory…</p>
          ) : (
            data && <InventorySkuTable rows={rows} showDoh showCustomer={false} onEdit={onEditRow} />
          )}
        </section>
      </div>
    </div>
  );
}
