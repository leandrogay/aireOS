'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import DataTable from '@/components/ui/DataTable';
import TablePagination, { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import ConfirmDeleteDialog from '@/components/promotions/ConfirmDeleteDialog';
import PromotionFilters from '@/components/promotions/PromotionFilters';
import PromotionRow from '@/components/promotions/PromotionRow';
import useConfirmAction from '@/hooks/useConfirmAction';
import { nextSort, paginate } from '@/app/utils/tableView';
import {
  dedupePromotions,
  filterPromotions,
  searchPromotions,
  sortPromotions,
  uniquePromotionMechanics,
  uniquePromotionPeriods,
  uniquePromotionRetailers,
  uniquePromotionStoreNames,
  uniquePromotionTypes,
} from '@/app/utils/promotionOverview';

import { PROMOTION_COLUMNS } from './columns';

// Keys match filterPromotions() in app/utils/promotionOverview.js.
const EMPTY_FILTERS = {
  retailer: '',
  storeName: '',
  period: '',
  promoType: '',
  mechanic: '',
  status: '',
};

/**
 * AO4-2 promotion overview: GET /api/promotions rows with filters, search,
 * sorting on the two dates, and paging, in the shared list-table card.
 * Edit and Delete live in each row's "..." menu; Delete asks first and
 * calls `onDelete` only on confirm. Which rows are open is the page's
 * (useExpandedRows), so a saved promotion can open itself.
 *
 * @param {{
 *   promotions?: object[],
 *   isLoading?: boolean,
 *   error?: string,
 *   highlightIds?: number[],
 *   editingId?: number | null,
 *   isExpanded: (promotionId: number) => boolean,
 *   onToggle: (promotionId: number) => void,
 *   onEdit: (promotion: object) => void,
 *   onDelete: (promotion: object) => Promise<void>,
 *   onRefresh: () => void,
 * }} props
 */
export default function PromotionList({
  promotions = [],
  isLoading = false,
  error = '',
  highlightIds = [],
  editingId = null,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  onRefresh,
}) {
  const highlighted = new Set(highlightIds);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'period_start', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const deletion = useConfirmAction({ onConfirm: onDelete });

  const uniquePromotions = dedupePromotions(promotions);
  const options = {
    retailers: uniquePromotionRetailers(uniquePromotions),
    stores: uniquePromotionStoreNames(uniquePromotions),
    periods: uniquePromotionPeriods(uniquePromotions),
    types: uniquePromotionTypes(uniquePromotions),
    mechanics: uniquePromotionMechanics(uniquePromotions),
  };

  const matching = searchPromotions(filterPromotions(uniquePromotions, filters), search);
  const sorted = sortPromotions(matching, sort.field, sort.direction);

  // Derived, not stored: deleting the last row of the last page lands on the
  // new last page instead of an empty one.
  const { pageRows, currentPage, totalPages } = paginate(sorted, page, pageSize);

  const hasFilters = Object.values(filters).some(Boolean) || search.trim() !== '';

  // Any change to what is listed goes back to page 1, where the result starts.
  const changeFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const changeSearch = (value) => {
    setSearch(value);
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearch('');
    setPage(1);
  };

  const changePageSize = (size) => {
    setPageSize(size);
    setPage(1);
  };

  const handleSort = (field) => {
    setSort((current) => nextSort(current, field));
    setPage(1);
  };

  const noMatches = !isLoading && uniquePromotions.length > 0 && sorted.length === 0 && (
    <>
      <p>No promotions match these filters.</p>
      {hasFilters && (
        <Button variant="outline" className="mt-3" onClick={resetFilters}>
          Reset filters
        </Button>
      )}
    </>
  );

  return (
    // Fills the height the page gives it (PageLayout fitScreen): the filter
    // bar keeps its size and the overview card takes the rest.
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <PromotionFilters
        filters={filters}
        options={options}
        hasFilters={hasFilters}
        onChange={changeFilter}
        onReset={resetFilters}
      />

      <DataTable
        label="Promotion overview"
        noun="promotion"
        totalCount={uniquePromotions.length}
        shownCount={sorted.length}
        isLoading={isLoading}
        error={error}
        onRefresh={onRefresh}
        emptyMessage="No promotions yet. Use Create promotion to add the first one."
        fill
        toolbar={
          <TableSearch
            value={search}
            onChange={changeSearch}
            label="Search promotions"
            placeholder="Search store, period, mechanic…"
          />
        }
        footer={
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalRows={sorted.length}
            onPageChange={setPage}
            onPageSizeChange={changePageSize}
          />
        }
        columns={PROMOTION_COLUMNS}
        minWidth="72rem"
        sort={sort}
        onSort={handleSort}
        emptyState={noMatches || null}
      >
        {pageRows.map((promotion) => {
          const id = promotion.promotion_id;
          return (
            <PromotionRow
              key={id}
              promotion={promotion}
              isOpen={isExpanded(id)}
              isEditing={editingId === id}
              isNew={highlighted.has(id)}
              onToggle={() => onToggle(id)}
              onEdit={onEdit}
              onDelete={deletion.request}
            />
          );
        })}
      </DataTable>

      <ConfirmDeleteDialog
        promotion={deletion.target}
        isDeleting={deletion.isPending}
        onCancel={deletion.cancel}
        onConfirm={deletion.confirm}
      />
    </div>
  );
}
