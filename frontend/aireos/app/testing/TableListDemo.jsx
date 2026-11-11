'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import ExpandableRow from '@/components/ui/ExpandableRow';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import PaginatedDataTable from '@/components/ui/PaginatedDataTable';
import RecordCardList from '@/components/ui/RecordCardList';
import RowActions from '@/components/ui/RowActions';
import SegmentedControl from '@/components/ui/SegmentedControl';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid, { EXPANDED_ROW_INSET, hideClass } from '@/components/ui/TableGrid';
import { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableRow from '@/components/ui/TableRow';
import TableSearch from '@/components/ui/TableSearch';
import useExpandedRows from '@/hooks/useExpandedRows';
import { cn } from '@/lib/utils';
import { nextSort, paginate } from '@/app/utils/tableView';

import { SAMPLE_STORES, STORE_COLUMNS, STORE_SKU_COLUMNS, STORE_STATUS, visibleStores } from './tableGalleryData';

// The live list table of the table kit's gallery; see TableGallery.jsx.

// What the state toggle puts the table in. Each one is a set of DataTable
// props, as a real list would pass them while fetching.
const STATES = [
  { value: 'loaded', label: 'Loaded' },
  { value: 'firstLoad', label: 'First load' },
  { value: 'refreshing', label: 'Refreshing' },
  { value: 'error', label: 'Error' },
  { value: 'empty', label: 'Empty' },
];

// How long the demo's Refresh spins before the "fetch" comes back.
const FAKE_REFRESH_MS = 900;

const numberFormat = new Intl.NumberFormat('en-SG');

function storeActions(store) {
  return [
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => {} },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: () => {},
      disabledReason: store.status === 'active' ? 'Active stores have sales; close it first' : undefined,
    },
  ];
}

/**
 * The store's SKUs, in a nested TableGrid whose columns line up with the
 * store table's through `inset`.
 *
 * @param {{ store: object }} props
 */
function StoreSkuTable({ store }) {
  return (
    <TableGrid variant="nested" columns={STORE_SKU_COLUMNS} inset={EXPANDED_ROW_INSET}>
      {store.skus.map((item) => (
        <TableRow key={item.sku} className="h-10 border-b border-lavander/80 last:border-b-0">
          <td className="truncate px-4 py-2 font-medium">{item.sku}</td>
          <td className={cn('px-4 py-2', hideClass(STORE_SKU_COLUMNS[1]))}>{item.range}</td>
          <td className={cn('px-4 py-2', hideClass(STORE_SKU_COLUMNS[2]))}>{item.pack}</td>
          <td className="px-4 py-2 text-right tabular-nums">{numberFormat.format(item.units)}</td>
          <td className="px-4 py-2 text-right tabular-nums">{Math.round(item.share * 100)}%</td>
        </TableRow>
      ))}
    </TableGrid>
  );
}

export default function TableListDemo() {
  const [tableState, setTableState] = useState('loaded');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: null, direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const { isExpanded, toggle } = useExpandedRows();

  const hasRows = tableState === 'loaded' || tableState === 'refreshing' || tableState === 'error';
  const stores = hasRows ? SAMPLE_STORES : [];
  const shown = visibleStores(stores, search, sort);
  const { pageRows, currentPage, totalPages } = paginate(shown, page, pageSize);

  // Refresh and Retry "fetch" again: spin for a moment, then come back loaded.
  function refresh() {
    setTableState('refreshing');
    setTimeout(() => setTableState('loaded'), FAKE_REFRESH_MS);
  }

  function changeSearch(value) {
    setSearch(value);
    setPage(1);
  }

  function changeSort(field) {
    setSort((current) => nextSort(current, field));
    setPage(1);
  }

  function changePageSize(size) {
    setPageSize(size);
    setPage(1);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-deep-violet-blue/70">
        <span>State:</span>
        <SegmentedControl value={tableState} onChange={setTableState} options={STATES} ariaLabel="Table state" />
        <span className="font-mono text-[10px] text-deep-violet-blue/50">
          isLoading={String(tableState === 'firstLoad' || tableState === 'refreshing')} error=
          {tableState === 'error' ? '"…"' : 'null'} totalCount={stores.length}
        </span>
      </div>

      {/* A fixed height stands in for PageLayout fitScreen, so `fill` and the
          sticky header show the way they do on Promotions. */}
      <div className="flex h-[34rem] flex-col">
        <PaginatedDataTable
          label="Stores (demo)"
          noun="store"
          totalCount={stores.length}
          shownCount={shown.length}
          isLoading={tableState === 'firstLoad' || tableState === 'refreshing'}
          error={tableState === 'error' ? 'Could not load stores: 503 Service Unavailable. Try again in a minute.' : null}
          onRefresh={refresh}
          emptyMessage="No stores yet. Use Add store to create the first one."
          fill
          toolbar={(
            <TableSearch value={search} onChange={changeSearch} label="Search stores" placeholder="Search store, retailer, format…" />
          )}
          columns={STORE_COLUMNS}
          sort={sort}
          onSort={changeSort}
          emptyState={hasRows && shown.length === 0 ? `No stores match “${search}”.` : null}
          pagination={{
            page: currentPage,
            totalPages,
            pageSize,
            totalRows: shown.length,
            onPageChange: setPage,
            onPageSizeChange: changePageSize,
          }}
          mobileContent={(
            <RecordCardList>
              {pageRows.map((store) => (
                <MobileRecordCard
                  key={store.id}
                  title={store.name}
                  subtitle={store.retailer}
                  badge={<StatusPill tone={STORE_STATUS[store.status].tone}>{STORE_STATUS[store.status].label}</StatusPill>}
                  actions={<RowActions label={`Actions for ${store.name}`} actions={storeActions(store)} />}
                  fields={[
                    { label: 'Format', value: store.format },
                    { label: 'Units sold', value: numberFormat.format(store.units) },
                  ]}
                />
              ))}
            </RecordCardList>
          )}
        >
          {pageRows.map((store) => {
            const isOpen = isExpanded(store.id);
            const status = STORE_STATUS[store.status];
            return (
              <ExpandableRow
                key={store.id}
                columnCount={STORE_COLUMNS.length}
                isOpen={isOpen}
                onToggle={() => toggle(store.id)}
                // The first two rows show the highlights a save leaves behind.
                highlight={store.id === 1 ? 'editing' : store.id === 2 ? 'new' : null}
                primary={store.name}
                title={store.name}
                toggleLabel={isOpen ? `Hide SKUs for ${store.name}` : `Show SKUs for ${store.name}`}
                actions={<RowActions label={`Actions for ${store.name}`} actions={storeActions(store)} />}
                details={<StoreSkuTable store={store} />}
              >
                <td className={cn('truncate px-4 py-2.5', hideClass(STORE_COLUMNS[1]))}>{store.retailer}</td>
                <td className={cn('truncate px-4 py-2.5', hideClass(STORE_COLUMNS[2]))}>{store.format}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{numberFormat.format(store.units)}</td>
                <td className="px-4 py-2.5">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </td>
              </ExpandableRow>
            );
          })}
        </PaginatedDataTable>
      </div>
    </div>
  );
}
