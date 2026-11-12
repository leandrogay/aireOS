'use client';

import { useState } from 'react';

import SelectDropdown from '@/components/ui/SelectDropdown';
import TableRow from '@/components/ui/TableRow';
import useAtRisk from '@/hooks/useAtRisk';
import { formatDoh, formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { customerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

import { AT_RISK_COLUMNS } from './columns';
import { filterLabelClass, InventoryFilterCard, StatTag } from './InventoryChrome';
import InventoryTableFrame, {
  inventoryCellClass,
  inventoryNumberCellClass,
  inventoryRowHeightClass,
} from './InventoryTableFrame';

const RISK_LABELS = { below_min: 'Low stock', above_max: 'Overstock' };
const RISK_CLASSES = { below_min: 'text-red-700', above_max: 'text-amber-700' };
const RISK_OPTIONS = [
  { value: '', label: 'All at-risk SKUs' },
  { value: 'below_min', label: 'Low stock (below min)' },
  { value: 'above_max', label: 'Overstock (above max)' },
];

/**
 * One list of every SKU at risk across all customers: days of holding below the
 * customer's min (low stock) or above its max (overstock) in the latest month of
 * actuals, most severe first. Nothing is stored: the list is recalculated on
 * every load, so a SKU drops off it once new data brings it back inside its band.
 *
 * @param {object} props
 * @param {Array<{ customer_id: number, customer_name: string }>} props.customers
 * @param {number} props.refreshKey bumped after a create/edit
 */
export default function AtRiskView({ customers, refreshKey }) {
  const [customerId, setCustomerId] = useState('');
  const [risk, setRisk] = useState('');

  const { data, loading, error } = useAtRisk({
    customerIds: customerId ? [Number(customerId)] : [],
    risk,
    refreshKey,
  });

  function clearFilters() {
    setCustomerId('');
    setRisk('');
  }

  return (
    <div className="space-y-3">
      <InventoryFilterCard
        canClear={Boolean(customerId || risk)}
        onClear={clearFilters}
        stats={data?.as_of ? (
          <>
            <StatTag label="As of" value={formatMonth(data.as_of)} />
            <StatTag label="Low stock" value={String(data.counts.below_min)} />
            <StatTag label="Overstock" value={String(data.counts.above_max)} />
          </>
        ) : null}
      >
        <div className="min-w-0">
          <span className={filterLabelClass}>Customer</span>
          <SelectDropdown
            value={customerId}
            onChange={setCustomerId}
            options={[
              { value: '', label: 'All customers' },
              ...customers.map((c) => ({ value: String(c.customer_id), label: customerLabel(c.customer_name) })),
            ]}
            ariaLabel="Customer"
            look="compact"
          />
        </div>

        <div className="min-w-0">
          <span className={filterLabelClass}>Risk</span>
          <SelectDropdown value={risk} onChange={setRisk} options={RISK_OPTIONS} ariaLabel="Risk" look="compact" />
        </div>
      </InventoryFilterCard>

      {error && (
        <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue" role="alert">
          {error}
        </p>
      )}

      {(data || loading) && (
        <InventoryTableFrame
          title="At-risk SKUs"
          rows={data?.items ?? []}
          columns={AT_RISK_COLUMNS}
          minWidth="68rem"
          emptyMessage="No SKUs are at risk."
          loading={loading && !data}
          description="A SKU is at risk when its days of holding is outside the customer's min-max band. It leaves this list automatically once its days of holding is back inside the band."
        >
          {(pageRows) => pageRows.map((item) => (
            <TableRow key={`${item.customer_id}-${item.sku}`} className={inventoryRowHeightClass}>
              <td className={inventoryCellClass}>{customerLabel(item.customer_name)}</td>
              <td className={cn(inventoryCellClass, 'font-medium')}>{formatMonth(item.month)}</td>
              <td className={cn(inventoryCellClass, 'font-mono')}>{item.sku}</td>
              <td className={cn(inventoryCellClass, 'truncate')} title={item.product_name}>{item.product_name}</td>
              <td className={inventoryNumberCellClass}>{formatUnits(item.ending_stock)}</td>
              <td className={inventoryNumberCellClass}>{formatDoh(item.doh)}</td>
              <td className={inventoryNumberCellClass}>{formatDoh(item.min_doh)}</td>
              <td className={inventoryNumberCellClass}>{formatDoh(item.max_doh)}</td>
              <td className={cn(inventoryNumberCellClass, 'font-medium')}>{formatDoh(item.days_outside_band)}</td>
              <td className={cn(inventoryCellClass, RISK_CLASSES[item.doh_status])}>{RISK_LABELS[item.doh_status]}</td>
            </TableRow>
          ))}
        </InventoryTableFrame>
      )}
    </div>
  );
}
