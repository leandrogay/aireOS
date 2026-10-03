'use client';

import { useState } from 'react';

import useCustomerInventory from '@/hooks/useCustomerInventory';
import { DOH_STATUS_LABELS, earliestMonthInput, formatDoh, filterMonthRange, latestMonthInput } from '@/app/utils/inventoryForm';
import { retailerLabel } from '@/app/utils/retailerLabel';

import DohTrendChart from './DohTrendChart';
import {
  filterControlClass,
  filterLabelClass,
  InventoryChartSlot,
  InventorySection,
  monthRangeLabel,
  skuScopeLabel,
  StatTag,
} from './InventoryChrome';
import InventoryFilters from './InventoryFilters';
import InventorySkuTable from './InventorySkuTable';

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
  // null = the user has not touched the range, so it shows the full span of
  // the trend. Editing either picker (even to blank) makes the range theirs;
  // "Clear filters" returns it to null.
  const [startMonth, setStartMonth] = useState(null);
  const [endMonth, setEndMonth] = useState(null);
  const [status, setStatus] = useState('');

  // Adjust state during render: pick the first customer once the list arrives,
  // so the view is never empty by default. Runs only while nothing is chosen.
  if (customerId === null && customers.length > 0) {
    setCustomerId(customers[0].customer_id);
  }

  const { data, loading, error } = useCustomerInventory({
    customerId,
    skus,
    refreshKey,
  });

  // The API returns the full history. From/To open on that whole span, which
  // is what the trend draws, and both the trend and the table follow the range.
  const rangeRows = data?.trend?.length ? data.trend : data?.skus ?? [];
  const defaultStart = earliestMonthInput(rangeRows);
  const defaultEnd = latestMonthInput(rangeRows);
  const shownStart = startMonth ?? defaultStart;
  const shownEnd = endMonth ?? defaultEnd;
  const trend = data ? filterMonthRange(data.trend, shownStart, shownEnd) : undefined;

  function clearFilters() {
    setSkus([]);
    setStartMonth(null);
    setEndMonth(null);
    setStatus('');
  }

  const rows = data
    ? filterMonthRange(data.skus, shownStart, shownEnd).filter((row) => !status || row.doh_status === status)
    : [];
  const threshold = data?.threshold;

  const customerName = customers.find((c) => c.customer_id === customerId)?.customer_name;
  const scopeTags = [
    { label: 'Customer', value: customerName ? retailerLabel(customerName) : '—' },
    { label: 'SKU', value: skuScopeLabel(skus) },
    { label: 'Months', value: monthRangeLabel(shownStart, shownEnd) },
    { label: 'Status', value: status ? DOH_STATUS_LABELS[status] : 'All' },
  ];

  return (
    <div className="space-y-2">
      <InventoryFilters
        leading={(
          <label htmlFor="inventory-customer">
            <span className={filterLabelClass}>Customer</span>
            <select
              id="inventory-customer"
              value={customerId ?? ''}
              onChange={(e) => setCustomerId(Number(e.target.value))}
              className={filterControlClass}
            >
              {customers.map((c) => (
                <option key={c.customer_id} value={c.customer_id}>
                  {retailerLabel(c.customer_name)}
                </option>
              ))}
            </select>
          </label>
        )}
        stats={threshold ? (
          <>
            <StatTag label="DOH target" value={`${formatDoh(threshold.target_doh)} days`} />
            <StatTag
              label="Band"
              value={`${formatDoh(threshold.min_doh)}–${formatDoh(threshold.max_doh)}`}
            />
            {threshold.is_global_default ? <StatTag label="Source" value="Global default" /> : null}
          </>
        ) : null}
        skuOptions={skuOptions}
        skus={skus}
        onSkusChange={setSkus}
        startMonth={shownStart}
        endMonth={shownEnd}
        defaultStart={defaultStart}
        defaultEnd={defaultEnd}
        onStartMonthChange={setStartMonth}
        onEndMonthChange={setEndMonth}
        status={status}
        onStatusChange={setStatus}
        statusOptions={STATUS_OPTIONS}
        onClear={clearFilters}
      />

      {error && (
        <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue" role="alert">
          {error}
        </p>
      )}

      <InventorySection title="Days of holding (DOH) trend" tags={scopeTags}>
        <InventoryChartSlot loading={loading} ready={Boolean(data)}>
          {data && <DohTrendChart trend={trend} />}
        </InventoryChartSlot>
      </InventorySection>

      {loading && !data ? (
        <p className="text-xs text-muted-foreground">Loading inventory…</p>
      ) : (
        data && <InventorySkuTable rows={rows} showDoh showCustomer={false} onEdit={onEditRow} />
      )}
    </div>
  );
}
