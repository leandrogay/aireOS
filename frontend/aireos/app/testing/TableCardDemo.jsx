'use client';

import { useState } from 'react';

import InventoryTableFrame from '@/components/inventory/InventoryTableFrame';
import RefreshButton from '@/components/ui/RefreshButton';
import { Skeleton } from '@/components/ui/skeleton';
import StatusPill from '@/components/ui/StatusPill';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader, { TABLE_HEADER_BUTTON_CLASS } from '@/components/ui/TableCardHeader';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
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

// The frame puts its Month filter on the column keyed `month`.
const MONTH_COLUMNS = [
  { key: 'month', label: 'Month', width: '8rem' },
  { key: 'sku', label: 'SKU' },
  { key: 'sellOut', label: 'Sell-out', width: '8rem', align: 'right' },
  { key: 'endingStock', label: 'Ending stock', width: '9rem', align: 'right' },
  { key: 'doh', label: 'DOH', width: '6rem', align: 'right' },
];

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
 * A titled card holding a TableGrid: the shape of the Dashboard SKU ranking
 * and the Forecast monthly values.
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
            actions={<RefreshButton onClick={() => {}} isRefreshing={loading} label="Refresh latest month" className={TABLE_HEADER_BUTTON_CLASS} />}
          />
        )}
      >
        <TableGrid columns={SUMMARY_COLUMNS} isLoading={loading} skeletonRows={2}>
          {!loading && LATEST_MONTH.map((row) => {
            const status = dohStatus(row.doh);
            return (
              <TableRow key={row.sku} className="h-12 border-b border-lavander/80">
                <td className="truncate px-4 py-2.5 font-medium">{row.sku}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{numberFormat.format(row.sellOut)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{numberFormat.format(row.endingStock)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{row.doh}</td>
                <td className="px-4 py-2.5">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </td>
              </TableRow>
            );
          })}
        </TableGrid>
      </TableCard>
    </div>
  );
}

/**
 * The Inventory tabs' frame, live: a TableGrid whose Month column filters
 * from its header (`filter`), the row count in the header, and paging.
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
        columns={MONTH_COLUMNS}
        minWidth="36rem"
        loading={loading}
      >
        {(pageRows) => pageRows.map((row) => (
          <TableRow key={`${row.month}-${row.sku}`} className="h-12 border-b border-lavander/80">
            <td className="px-4 py-2.5">{monthLabel(row.month)}</td>
            <td className="truncate px-4 py-2.5 font-medium">{row.sku}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{numberFormat.format(row.sellOut)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{numberFormat.format(row.endingStock)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{row.doh}</td>
          </TableRow>
        ))}
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
