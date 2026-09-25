'use client';

import { useState } from 'react';

import useInventoryOverview from '@/hooks/useInventoryOverview';
import { monthInputToDate } from '@/app/utils/inventoryForm';

import EndingStockChart from './EndingStockChart';
import InventoryFilters from './InventoryFilters';
import InventorySkuTable from './InventorySkuTable';
import { cardClass } from './formStyles';

/**
 * Overall inventory for every customer: ending stock per month as a bar per
 * customer, and the same data at SKU level below, with SKU and month filters.
 * Ending stock is derived by the backend (see inventory_calc.build_monthly_series).
 *
 * @param {object} props
 * @param {Array<{ sku: string, product_name: string }>} props.skuOptions
 * @param {number} props.refreshKey bumped after a create/edit to refetch
 * @param {(row: object) => void} props.onEditRow
 */
export default function InventoryOverview({ skuOptions, refreshKey, onEditRow }) {
  const [skus, setSkus] = useState([]);
  const [startMonth, setStartMonth] = useState('');
  const [endMonth, setEndMonth] = useState('');

  const { data, loading, error } = useInventoryOverview({
    skus,
    startMonth: monthInputToDate(startMonth),
    endMonth: monthInputToDate(endMonth),
    refreshKey,
  });

  function clearFilters() {
    setSkus([]);
    setStartMonth('');
    setEndMonth('');
  }

  return (
    <div>
      <InventoryFilters
        skuOptions={skuOptions}
        skus={skus}
        onSkusChange={setSkus}
        startMonth={startMonth}
        endMonth={endMonth}
        onStartMonthChange={setStartMonth}
        onEndMonthChange={setEndMonth}
        onClear={clearFilters}
      />

      {error && <p className="mb-2 text-sm text-red-600" role="alert">{error}</p>}

      <div className="grid grid-cols-1 gap-2">
        <section className={cardClass}>
          <h2 className="mb-1 text-sm font-medium text-deep-violet-blue">Ending stock by month</h2>
          <p className="mb-2 text-xs text-deep-violet-blue/60">
            Ending stock = previous month&apos;s ending stock + sell-in − sell-out.
          </p>
          {loading && !data ? (
            <p className="text-sm text-deep-violet-blue/70">Loading inventory…</p>
          ) : (
            data && <EndingStockChart monthly={data.monthly} />
          )}
        </section>

        <section className={cardClass}>
          <h2 className="mb-2 text-sm font-medium text-deep-violet-blue">Inventory by SKU</h2>
          {loading && !data ? (
            <p className="text-sm text-deep-violet-blue/70">Loading inventory…</p>
          ) : (
            data && <InventorySkuTable rows={data.skus} onEdit={onEditRow} />
          )}
        </section>
      </div>
    </div>
  );
}
