'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import RefreshButton from '@/components/ui/RefreshButton';
import ConfirmDeleteDialog from '@/components/promotions/ConfirmDeleteDialog';
import PromotionFilters from '@/components/promotions/PromotionFilters';
import PromotionPagination, { PAGE_SIZES } from '@/components/promotions/PromotionPagination';
import PromotionRow from '@/components/promotions/PromotionRow';
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

// Keys match filterPromotions() in app/utils/promotionOverview.js.
const EMPTY_FILTERS = {
  retailer: '',
  storeName: '',
  period: '',
  promoType: '',
  mechanic: '',
  status: '',
};

const headerClass = 'px-4 py-2.5 text-xs font-medium text-deep-violet-blue/60';

/**
 * Column header that sorts on press. Same column again flips direction.
 */
function SortHeader({ label, field, sortField, sortDirection, onSort }) {
  const active = sortField === field;
  const Icon = !active ? ArrowUpDown : sortDirection === 'asc' ? ArrowUp : ArrowDown;
  const ariaSort = !active ? 'none' : sortDirection === 'asc' ? 'ascending' : 'descending';

  return (
    <th scope="col" aria-sort={ariaSort} className={headerClass}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 rounded-md outline-none transition-colors hover:text-deep-violet-blue focus-visible:ring-3 focus-visible:ring-ring/50 ${
          active ? 'text-deep-violet-blue' : ''
        }`}
      >
        {label}
        <Icon aria-hidden="true" className="size-3.5" />
      </button>
    </th>
  );
}

// Placeholder rows while the first load is in flight, so the table does not
// jump from empty to full.
function LoadingRows() {
  return Array.from({ length: 6 }, (_, row) => (
    <tr key={row} className="h-12 border-b border-lavander/80">
      {Array.from({ length: 9 }, (_, cell) => (
        <td key={cell} className="px-4 py-3.5">
          <div className="h-3.5 w-full max-w-[6rem] animate-pulse rounded bg-lavander" />
        </td>
      ))}
    </tr>
  ));
}

/**
 * AO4-2 promotion overview: GET /api/promotions rows with filters, search,
 * sorting on the two dates, and paging. Edit and Delete live in each row's
 * "..." menu.
 *
 * @param {object} props
 */
export default function PromotionList({
  promotions = [],
  isLoading = false,
  error = '',
  highlightIds = [],
  editingId = null,
  onEdit,
  onDelete,
  onRefresh,
}) {
  const highlighted = new Set(highlightIds);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('period_start');
  const [sortDirection, setSortDirection] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [expandedId, setExpandedId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const uniquePromotions = dedupePromotions(promotions);
  const options = {
    retailers: uniquePromotionRetailers(uniquePromotions),
    stores: uniquePromotionStoreNames(uniquePromotions),
    periods: uniquePromotionPeriods(uniquePromotions),
    types: uniquePromotionTypes(uniquePromotions),
    mechanics: uniquePromotionMechanics(uniquePromotions),
  };

  const matching = searchPromotions(filterPromotions(uniquePromotions, filters), search);
  const sorted = sortPromotions(matching, sortField, sortDirection);

  // Derived, not stored: deleting the last row of the last page lands on the
  // new last page instead of an empty one.
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const hasFilters = Object.values(filters).some(Boolean) || search.trim() !== '';
  const showTable = uniquePromotions.length > 0 || isLoading;

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
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setPage(1);
  };

  const cancelDelete = () => {
    if (isDeleting) return;
    setPendingDelete(null);
  };

  // DELETE is only called from here; Cancel never reaches the API.
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await onDelete?.(pendingDelete);
      setPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    // Fills the height the page gives it (PageLayout fitScreen): the filter
    // bar keeps its size and the overview card takes the rest.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PromotionFilters
        filters={filters}
        options={options}
        hasFilters={hasFilters}
        onChange={changeFilter}
        onReset={resetFilters}
      />

      {/* The card's size comes from the window, not from how many rows are
          listed, so searching or changing rows per page never resizes it;
          the rows scroll inside. min-h-80 keeps the table usable on a short
          window (the page scrolls instead). */}
      <section className="flex min-h-80 flex-1 flex-col overflow-hidden rounded-lg border border-lavander bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="font-serif text-xl text-deep-violet-blue">Promotion overview</h2>
            <p className="mt-0.5 text-xs text-deep-violet-blue/70">
              {isLoading && !uniquePromotions.length
                ? 'Loading promotions…'
                : `${sorted.length} of ${uniquePromotions.length} shown.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative">
              <span className="sr-only">Search promotions</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-deep-violet-blue/50"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
                placeholder="Search store, period, mechanic…"
                className="h-9 w-64 max-w-full rounded-lg border border-lavander bg-white pl-8 pr-2.5 text-sm text-deep-violet-blue outline-none placeholder:text-deep-violet-blue/40 focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </label>
            <RefreshButton
              onClick={onRefresh}
              isRefreshing={isLoading}
              label="Refresh promotions"
              className="rounded-md border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream"
            />
          </div>
        </div>

        {error && (
          <p className="mx-4 mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {!error && !showTable && (
          <p className="px-4 pb-4 text-sm text-deep-violet-blue/80">No promotions registered yet.</p>
        )}

        {showTable && (
          <>
            <div
              // relative: the header's sr-only "Actions" label is absolutely
              // positioned; without a positioned ancestor it escapes this
              // scroll box and widens the whole page on narrow windows.
              className="relative min-h-0 flex-1 overflow-auto border-t border-lavander"
            >
              <table className="w-full whitespace-nowrap text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle">
                {/* Stays in view while the rows scroll. White under the cream
                    tint so rows do not show through; the bottom rule is an
                    inset shadow because a collapsed table border does not
                    move with a sticky header. */}
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="h-10 bg-cream/60 [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]">
                    <th scope="col" className={headerClass}>Retailer</th>
                    <th scope="col" className={headerClass}>Stores</th>
                    <SortHeader
                      label="Start date"
                      field="period_start"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="End date"
                      field="period_end"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <th scope="col" className={headerClass}>Period</th>
                    <th scope="col" className={headerClass}>Promo type</th>
                    <th scope="col" className={headerClass}>Mechanic</th>
                    <th scope="col" className={headerClass}>Status</th>
                    <th scope="col" className="w-px px-2 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && !uniquePromotions.length && <LoadingRows />}
                  {!isLoading && sorted.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-24 text-center text-deep-violet-blue/80">
                        <p>No promotions match these filters.</p>
                        {hasFilters && (
                          <Button variant="outline" className="mt-3" onClick={resetFilters}>
                            Reset filters
                          </Button>
                        )}
                      </td>
                    </tr>
                  )}
                  {pageRows.map((promotion) => {
                    const id = promotion.promotion_id;
                    const isOpen = expandedId === id;
                    return (
                      <PromotionRow
                        key={id}
                        promotion={promotion}
                        isOpen={isOpen}
                        isEditing={editingId === id}
                        isNew={highlighted.has(id)}
                        onToggle={() => setExpandedId(isOpen ? null : id)}
                        onEdit={onEdit}
                        onDelete={setPendingDelete}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PromotionPagination
              page={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              totalRows={sorted.length}
              onPageChange={setPage}
              onPageSizeChange={changePageSize}
            />
          </>
        )}
      </section>

      <ConfirmDeleteDialog
        promotion={pendingDelete}
        isDeleting={isDeleting}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
