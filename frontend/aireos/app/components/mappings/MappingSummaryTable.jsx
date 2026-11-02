'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import RefreshButton from '@/components/ui/RefreshButton';
import SortHeader, { TABLE_HEADER_CLASS as headerClass } from '@/components/ui/SortHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import TablePagination, { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import TableSkeleton from '@/components/ui/TableSkeleton';
import MappingFilters from '@/components/mappings/MappingFilters';
import { formatDate } from '@/lib/formatDate';
import {
  filterMappings,
  mappingCustomer,
  mappingSourceLine,
  mappingStatus,
  mappingTitle,
  searchMappings,
  sortMappings,
  uniqueMappingCustomers,
} from '@/app/utils/mappingList';
import { nextSort, paginate } from '@/app/utils/tableView';

// Keys match filterMappings() in app/utils/mappingList.js; each is the list of
// values ticked, empty for "all".
const EMPTY_FILTERS = { customer: [], status: [], issues: [] };

const COLUMN_COUNT = 5;

/**
 * Stored mappings (GET /api/mappings), laid out like the promotion overview:
 * one card with count, filters, search and refresh, the table, and paging. Clicking a row opens it for review; the rules themselves are only
 * shown there, so this list stays short.
 *
 * @param {{
 *   mappings: object[],
 *   isLoading: boolean,
 *   error: string,
 *   onOpen: (mappingId: string) => void,
 *   onRefresh: () => void,
 * }} props
 */
export default function MappingSummaryTable({ mappings, isLoading, error, onOpen, onRefresh }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  // No sort to start with: the backend lists confirmed mappings first, then
  // proposals, which is the order a reviewer wants until they pick another.
  const [sort, setSort] = useState({ field: null, direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const matching = searchMappings(filterMappings(mappings, filters), search);
  const sorted = sortMappings(matching, sort.field, sort.direction);
  const { pageRows, currentPage, totalPages } = paginate(sorted, page, pageSize);

  const hasFilters = Object.values(filters).some((values) => values.length > 0) || search.trim() !== '';
  const showTable = mappings.length > 0 || isLoading;

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

  const changeSort = (field) => {
    setSort((current) => nextSort(current, field));
    setPage(1);
  };

  const changePageSize = (size) => {
    setPageSize(size);
    setPage(1);
  };

  return (
    // Fills the height the page gives it (PageLayout fitScreen). Sized by the
    // window, not the row count, so filtering never resizes it; the rows
    // scroll inside. Same as the promotion overview.
    <div className="flex min-h-0 flex-1 flex-col">
      <section
        aria-label="Stored nomenclatures"
        className="flex min-h-80 flex-1 flex-col overflow-hidden rounded-lg border border-lavander bg-white shadow-sm"
      >
        {/* Filters left, search and refresh right. No count line: the
            footer already says how many rows there are. The search box
            shrinks before anything wraps. */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <MappingFilters
            filters={filters}
            customers={uniqueMappingCustomers(mappings)}
            hasFilters={hasFilters}
            onChange={changeFilter}
            onReset={resetFilters}
          />
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
            <TableSearch
              value={search}
              onChange={changeSearch}
              label="Search nomenclatures"
              placeholder="Search nomenclatures…"
              className="min-w-40 max-w-64 flex-1"
            />
            <RefreshButton
              onClick={onRefresh}
              isRefreshing={isLoading}
              label="Refresh nomenclatures"
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
          <p className="px-4 pb-4 text-sm text-deep-violet-blue/80">No stored nomenclatures found yet.</p>
        )}

        {showTable && (
          <>
            {/* relative: the sr-only header label is absolutely positioned and
                would otherwise escape this scroll box. */}
            <div className="relative min-h-0 flex-1 overflow-auto border-t border-lavander">
              {/* Fixed widths so the columns stay put whatever the rows hold;
                  the nomenclature column takes the rest. */}
              <table className="w-full table-fixed whitespace-nowrap text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle">
                <colgroup>
                  <col />
                  <col className="w-40" />
                  <col className="w-40" />
                  <col className="w-28" />
                  <col className="w-10" />
                </colgroup>
                {/* Stays in view while the rows scroll. White under the cream
                    tint so rows do not show through; the bottom rule is an
                    inset shadow because a collapsed table border does not
                    move with a sticky header. */}
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="h-10 bg-cream/60 [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]">
                    <SortHeader
                      label="Nomenclature"
                      field="name"
                      sortField={sort.field}
                      sortDirection={sort.direction}
                      onSort={changeSort}
                    />
                    <SortHeader
                      label="Customer"
                      field="customer"
                      sortField={sort.field}
                      sortDirection={sort.direction}
                      onSort={changeSort}
                    />
                    <th scope="col" className={headerClass}>Status</th>
                    <th scope="col" className={headerClass}>Approved</th>
                    <th scope="col" className="px-2">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && !mappings.length && (
                    <TableSkeleton columns={COLUMN_COUNT} className="h-14" />
                  )}
                  {!isLoading && mappings.length > 0 && sorted.length === 0 && (
                    <tr>
                      <td colSpan={COLUMN_COUNT} className="px-4 py-24 text-center text-deep-violet-blue/80">
                        <p>No nomenclatures match these filters.</p>
                        {hasFilters && (
                          <Button variant="outline" className="mt-3" onClick={resetFilters}>
                            Reset filters
                          </Button>
                        )}
                      </td>
                    </tr>
                  )}
                  {pageRows.map((mapping) => {
                    const status = mappingStatus(mapping);
                    const sourceLine = mappingSourceLine(mapping);

                    return (
                      <tr
                        key={mapping.mappingId}
                        onClick={() => onOpen(mapping.mappingId)}
                        className="group h-14 cursor-pointer border-b border-lavander/80 bg-white transition-colors focus-within:bg-cream/50 hover:bg-cream/50"
                      >
                        <td className="px-4 py-2.5">
                          <div className="max-w-full">
                            {/* The button is the keyboard route in; the row click is
                                the same action for a mouse. */}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpen(mapping.mappingId);
                              }}
                              className="block max-w-full truncate rounded-md text-left font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                              title={mappingTitle(mapping)}
                            >
                              {mappingTitle(mapping)}
                            </button>
                            {sourceLine && (
                              <p className="truncate text-xs text-deep-violet-blue/60" title={mapping.filename || sourceLine}>
                                {sourceLine}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="truncate px-4 py-2.5" title={mappingCustomer(mapping) || undefined}>
                          {mappingCustomer(mapping) || '—'}
                          {/* Approved before customers existed: its sales may
                              sit on retailers no customer owns. Linked on its
                              next save. */}
                          {mapping.state === 'confirmed' && !mapping.customerId && (
                            <span className="ml-1.5 text-xs text-amber-900">(not linked)</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                          {status.detail && (
                            <p className="mt-0.5 truncate text-xs text-amber-900">{status.detail}</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-deep-violet-blue/80">
                          {mapping.validatedAt ? formatDate(mapping.validatedAt) : '—'}
                        </td>
                        <td className="px-2 py-2.5">
                          <ChevronRight
                            aria-hidden="true"
                            className="size-4 text-deep-violet-blue/30 transition-colors group-focus-within:text-deep-violet-blue group-hover:text-deep-violet-blue"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination
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
    </div>
  );
}
