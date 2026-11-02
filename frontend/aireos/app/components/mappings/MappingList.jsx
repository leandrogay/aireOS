'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import DataTable from '@/components/ui/DataTable';
import TablePagination, { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import MappingFilters from '@/components/mappings/MappingFilters';
import MappingRow from '@/components/mappings/MappingRow';
import {
  filterMappings,
  searchMappings,
  sortMappings,
  uniqueMappingCustomers,
} from '@/app/utils/mappingList';
import { nextSort, paginate } from '@/app/utils/tableView';

import { MAPPING_COLUMNS } from './columns';

// Keys match filterMappings() in app/utils/mappingList.js; each is the list of
// values ticked, empty for "all".
const EMPTY_FILTERS = { customer: [], status: [], issues: [] };

/**
 * Stored mappings (GET /api/mappings), laid out like the promotion overview:
 * a filter bar, then the shared list-table card with count, search and
 * refresh, the table, and paging. Clicking a row opens it for review; the
 * rules themselves are only shown there, so this list stays short.
 *
 * @param {{
 *   mappings: object[],
 *   isLoading: boolean,
 *   error: string,
 *   onOpen: (mappingId: string) => void,
 *   onRefresh: () => void,
 * }} props
 */
export default function MappingList({ mappings, isLoading, error, onOpen, onRefresh }) {
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

  const noMatches = !isLoading && mappings.length > 0 && sorted.length === 0 && (
    <>
      <p>No nomenclatures match these filters.</p>
      {hasFilters && (
        <Button variant="outline" className="mt-3" onClick={resetFilters}>
          Reset filters
        </Button>
      )}
    </>
  );

  return (
    // Fills the height the page gives it (PageLayout fitScreen): the filter
    // bar keeps its size and the table card takes the rest.
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <MappingFilters
        filters={filters}
        customers={uniqueMappingCustomers(mappings)}
        hasFilters={hasFilters}
        onChange={changeFilter}
        onReset={resetFilters}
      />

      <DataTable
        label="Stored nomenclatures"
        noun="nomenclature"
        totalCount={mappings.length}
        shownCount={sorted.length}
        isLoading={isLoading}
        error={error}
        onRefresh={onRefresh}
        emptyMessage="No stored nomenclatures found yet."
        fill
        toolbar={
          <TableSearch
            value={search}
            onChange={changeSearch}
            label="Search nomenclatures"
            placeholder="Search name, file, customer…"
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
        columns={MAPPING_COLUMNS}
        minWidth="48rem"
        sort={sort}
        onSort={changeSort}
        emptyState={noMatches || null}
      >
        {pageRows.map((mapping) => (
          <MappingRow key={mapping.mappingId} mapping={mapping} onOpen={onOpen} />
        ))}
      </DataTable>
    </div>
  );
}
