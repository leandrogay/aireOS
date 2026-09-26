'use client';

import { useState } from 'react';

import useInventoryOverview from '@/hooks/useInventoryOverview';
import { filterMonthRange, latestMonthInput } from '@/app/utils/inventoryForm';

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
  // null = the user has not touched the range, so it shows the newest month of data. Editing
  // either picker (even to blank) makes the range theirs; "Clear filters" returns it to null.
  const [startMonth, setStartMonth] = useState(null);
  const [endMonth, setEndMonth] = useState(null);
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const { data, loading, error } = useInventoryOverview({
    skus,
    atRiskOnly,
    refreshKey,
  });

  // The API returns the full history. The table is narrowed to the range (the newest month until
  // the user picks one); the chart keeps the whole history until the range is edited.
  const defaultMonth = data ? latestMonthInput(data.skus) : '';
  const shownStart = startMonth ?? defaultMonth;
  const shownEnd = endMonth ?? defaultMonth;
  const rangeEdited = startMonth !== null || endMonth !== null;
  const tableRows = data ? filterMonthRange(data.skus, shownStart, shownEnd) : [];
  const chartRows = data && rangeEdited ? filterMonthRange(data.monthly, shownStart, shownEnd) : data?.monthly;
  const atRiskSkuCount = data ? new Set(data.skus.map((row) => `${row.customer_id}-${row.sku}`)).size : 0;

  function clearFilters() {
    setSkus([]);
    setStartMonth(null);
    setEndMonth(null);
    setAtRiskOnly(false);
  }

  return (
    <div>
      <InventoryFilters
        skuOptions={skuOptions}
        skus={skus}
        onSkusChange={setSkus}
        startMonth={shownStart}
        endMonth={shownEnd}
        defaultMonth={defaultMonth}
        onStartMonthChange={setStartMonth}
        onEndMonthChange={setEndMonth}
        atRiskOnly={atRiskOnly}
        onAtRiskChange={setAtRiskOnly}
        onClear={clearFilters}
      />

      {error && <p className="mb-2 text-sm text-red-600" role="alert">{error}</p>}

      {atRiskOnly && data && (
        <p className="mb-2 rounded-md border border-violet bg-lavander px-3 py-2 text-sm text-deep-violet-blue">
          {atRiskSkuCount === 0
            ? 'No SKUs are at risk right now.'
            : `Showing only the ${atRiskSkuCount} SKU${atRiskSkuCount === 1 ? '' : 's'} at risk. The chart and table both cover just these SKUs. See the At risk tab for the reasons.`}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2">
        <section className={cardClass}>
          <h2 className="mb-2 text-sm font-medium text-deep-violet-blue">Ending stock by month</h2>
          {loading && !data ? (
            <p className="text-sm text-deep-violet-blue/70">Loading inventory…</p>
          ) : (
            data && <EndingStockChart monthly={chartRows} />
          )}
        </section>

        <section className={cardClass}>
          <h2 className="mb-2 text-sm font-medium text-deep-violet-blue">Inventory by SKU</h2>
          {loading && !data ? (
            <p className="text-sm text-deep-violet-blue/70">Loading inventory…</p>
          ) : (
            data && <InventorySkuTable rows={tableRows} onEdit={onEditRow} />
          )}
        </section>
      </div>
    </div>
  );
}
