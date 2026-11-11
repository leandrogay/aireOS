'use client';

import { useState } from 'react';

import InventoryTableFrame, {
  InventoryColGroup,
  InventoryTableSkeleton,
  inventoryHeadRowClass,
  inventoryRowClass,
  inventoryTableClass,
  inventoryTdClass,
  inventoryThClass,
  inventoryTheadClass,
} from '@/components/inventory/InventoryTableFrame';
import RefreshButton from '@/components/ui/RefreshButton';
import { Skeleton } from '@/components/ui/skeleton';
import StatusPill from '@/components/ui/StatusPill';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader from '@/components/ui/TableCardHeader';
import TableGrid from '@/components/ui/TableGrid';
import ToggleButton from '@/components/ui/ToggleButton';

import { MONTHLY_ROWS } from './tableGalleryData';

// The titled table cards of the table kit's gallery; see TableGallery.jsx.

const SUMMARY_COLUMNS = [
  { key: 'sku', label: 'SKU', width: '12rem' },
  { key: 'sellOut', label: 'Sell-out', align: 'right' },
  { key: 'endingStock', label: 'Ending stock', align: 'right' },
  { key: 'doh', label: 'DOH', width: '6rem', align: 'right' },
  { key: 'status', label: 'Status', width: '8.5rem' },
];

const MONTH_WIDTHS = ['8rem', null, '8rem', '9rem', '6rem'];
// The headings after Month, which is the frame's monthHeader.
const VALUE_HEADINGS = ['SKU', 'Sell-out', 'Ending stock', 'DOH'];

const numberFormat = new Intl.NumberFormat('en-SG');
const LATEST_MONTH = MONTHLY_ROWS.filter((row) => row.month === '2026-09');

// DOH against a made-up 30–60 day band, as the DOH settings would set it.
function dohStatus(doh) {
  if (doh < 30) return { label: 'Low stock', tone: 'danger' };
  if (doh > 60) return { label: 'Overstock', tone: 'warning' };
  return { label: 'In band', tone: 'success' };
}

function monthLabel(month) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-SG', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * A titled card holding a TableGrid: the shape the Dashboard SKU ranking is
 * moving to.
 */
function SummaryCard() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-2">
      <ToggleButton pressed={loading} onChange={setLoading}>
        First load
      </ToggleButton>
      <TableCard
        label="Latest month by SKU (demo)"
        header={(
          <TableCardHeader
            title="Latest month by SKU"
            detail={loading
              ? <Skeleton aria-label="Loading rows" className="h-3 w-24 rounded bg-lavander" />
              : `${LATEST_MONTH.length} SKUs · September 2026`}
            actions={<RefreshButton onClick={() => {}} isRefreshing={loading} label="Refresh latest month" />}
          />
        )}
      >
        <TableGrid columns={SUMMARY_COLUMNS} isLoading={loading} skeletonRows={2}>
          {!loading && LATEST_MONTH.map((row) => {
            const status = dohStatus(row.doh);
            return (
              <tr key={row.sku} className="h-12 border-b border-lavander/80">
                <td className="truncate px-4 py-2.5 font-medium">{row.sku}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{numberFormat.format(row.sellOut)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{numberFormat.format(row.endingStock)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{row.doh}</td>
                <td className="px-4 py-2.5">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </td>
              </tr>
            );
          })}
        </TableGrid>
      </TableCard>
    </div>
  );
}

/**
 * The Inventory tabs' frame, live: a HeaderCheckboxFilter on the Month
 * column, the row count in the header, and paging.
 */
function MonthlyFrame() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-2">
      <ToggleButton pressed={loading} onChange={setLoading}>
        First load
      </ToggleButton>
      <InventoryTableFrame
        title="Monthly stock (demo)"
        description="Filter the Month column from its header"
        rows={loading ? [] : MONTHLY_ROWS}
        loading={loading}
      >
        {(visible, monthHeader) => (
          <table className={`${inventoryTableClass} table-fixed`} style={{ minWidth: '36rem' }}>
            <InventoryColGroup widths={MONTH_WIDTHS} />
            <thead className={inventoryTheadClass}>
              <tr className={inventoryHeadRowClass}>
                {monthHeader}
                {VALUE_HEADINGS.map((label, index) => (
                  <th key={label} scope="col" className={index === 0 ? inventoryThClass : `${inventoryThClass} text-right`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <InventoryTableSkeleton columns={VALUE_HEADINGS.length + 1} />}
              {visible.map((row) => (
                <tr key={`${row.month}-${row.sku}`} className={inventoryRowClass}>
                  <td className={inventoryTdClass}>{monthLabel(row.month)}</td>
                  <td className={`${inventoryTdClass} truncate font-medium`}>{row.sku}</td>
                  <td className={`${inventoryTdClass} text-right tabular-nums`}>{numberFormat.format(row.sellOut)}</td>
                  <td className={`${inventoryTdClass} text-right tabular-nums`}>{numberFormat.format(row.endingStock)}</td>
                  <td className={`${inventoryTdClass} text-right tabular-nums`}>{row.doh}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </InventoryTableFrame>
    </div>
  );
}

export default function TableCardDemo() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SummaryCard />
      <MonthlyFrame />
    </div>
  );
}
