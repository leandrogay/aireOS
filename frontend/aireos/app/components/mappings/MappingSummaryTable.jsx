'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import RefreshButton from '@/components/ui/RefreshButton';
import SortHeader, { TABLE_HEADER_CLASS as headerClass } from '@/components/ui/SortHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import TablePagination, { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import TableSkeleton from '@/components/ui/TableSkeleton';
import MappingFilters from '@/components/mappings/MappingFilters';
import {
  MAPPING_STATE_LABELS,
  filterMappings,
  issueSummary,
  mappingVendor,
  searchMappings,
  sortMappings,
  uniqueMappingVendors,
} from '@/app/utils/mappingList';
import { nextSort, paginate, resultCountLabel } from '@/app/utils/tableView';

// Keys match filterMappings() in app/utils/mappingList.js.
const EMPTY_FILTERS = { vendor: '', status: '', issues: '' };

const COLUMN_COUNT = 4;

/**
 * Stored mappings (GET /api/mappings), laid out like the promotion overview:
 * a filter bar, then a card with count, search and refresh, the table, and
 * paging. Clicking a row opens it for review; the rules themselves are only
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

  const hasFilters = Object.values(filters).some(Boolean) || search.trim() !== '';
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
    // Fills the height the page gives it (PageLayout fitScreen): the filter
    // bar keeps its size and the table card takes the rest.
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <MappingFilters
        filters={filters}
        vendors={uniqueMappingVendors(mappings)}
        hasFilters={hasFilters}
        onChange={changeFilter}
        onReset={resetFilters}
      />

      {/* Sized by the window, not the row count, so filtering never resizes
          it; the rows scroll inside. Same as the promotion overview. */}
      <section
        aria-label="Stored mappings"
        className="flex min-h-80 flex-1 flex-col overflow-hidden rounded-lg border border-lavander bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-deep-violet-blue/70" aria-live="polite">
            {isLoading && !mappings.length
              ? 'Loading mappings…'
              : resultCountLabel(sorted.length, mappings.length, 'mapping')}
          </p>
          <div className="flex items-center gap-2">
            <TableSearch
              value={search}
              onChange={changeSearch}
              label="Search mappings"
              placeholder="Search mapping, file, vendor…"
            />
            <RefreshButton
              onClick={onRefresh}
              isRefreshing={isLoading}
              label="Refresh mappings"
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
          <p className="px-4 pb-4 text-sm text-deep-violet-blue/80">No stored mappings found yet.</p>
        )}

        {showTable && (
          <>
            <div className="min-h-0 flex-1 overflow-auto border-t border-lavander">
              <table className="w-full whitespace-nowrap text-left text-sm text-deep-violet-blue [&_td]:align-middle [&_th]:align-middle">
                {/* Stays in view while the rows scroll. White under the cream
                    tint so rows do not show through; the bottom rule is an
                    inset shadow because a collapsed table border does not
                    move with a sticky header. */}
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="h-10 bg-cream/60 [&>th]:shadow-[inset_0_-1px_0_var(--color-lavander)]">
                    <SortHeader
                      label="Mapping"
                      field="name"
                      sortField={sort.field}
                      sortDirection={sort.direction}
                      onSort={changeSort}
                    />
                    <SortHeader
                      label="Vendor"
                      field="vendor"
                      sortField={sort.field}
                      sortDirection={sort.direction}
                      onSort={changeSort}
                    />
                    <th scope="col" className={headerClass}>Status</th>
                    <th scope="col" className={headerClass}>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && !mappings.length && (
                    <TableSkeleton columns={COLUMN_COUNT} className="h-14" />
                  )}
                  {!isLoading && mappings.length > 0 && sorted.length === 0 && (
                    <tr>
                      <td colSpan={COLUMN_COUNT} className="px-4 py-24 text-center text-deep-violet-blue/80">
                        <p>No mappings match these filters.</p>
                        {hasFilters && (
                          <Button variant="outline" className="mt-3" onClick={resetFilters}>
                            Reset filters
                          </Button>
                        )}
                      </td>
                    </tr>
                  )}
                  {pageRows.map((mapping) => {
                    const state = MAPPING_STATE_LABELS[mapping.state];
                    const issues = issueSummary(mapping);

                    return (
                      <tr
                        key={mapping.mappingId}
                        onClick={() => onOpen(mapping.mappingId)}
                        className="h-14 cursor-pointer border-b border-lavander/80 bg-white transition-colors hover:bg-cream/50"
                      >
                        <td className="px-4 py-2.5">
                          <div className="max-w-[24rem]">
                            {/* The button is the keyboard route in; the row click is
                                the same action for a mouse. */}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpen(mapping.mappingId);
                              }}
                              className="block max-w-full truncate rounded-md text-left font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                              title={mapping.name || mapping.mappingId}
                            >
                              {mapping.name || 'Unnamed mapping'}
                            </button>
                            {mapping.filename && (
                              <p className="truncate text-xs text-deep-violet-blue/60" title={mapping.filename}>
                                {mapping.filename}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">{mappingVendor(mapping) || '—'}</td>
                        <td className="px-4 py-2.5">
                          {state ? (
                            <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">{mapping.state || 'Unknown'}</StatusBadge>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {issues ? (
                            <span className="text-amber-900">{issues}</span>
                          ) : (
                            <span className="text-deep-violet-blue/60">—</span>
                          )}
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
