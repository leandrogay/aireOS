'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import PaginatedDataTable from '@/components/ui/PaginatedDataTable';
import { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import ConfirmDeleteDialog from '@/components/promotions/ConfirmDeleteDialog';
import PromotionFilters from '@/components/promotions/PromotionFilters';
import PromotionRow from '@/components/promotions/PromotionRow';
import { promotionRowActions } from '@/components/promotions/PromotionRow';
import PromotionDetails from '@/components/promotions/PromotionDetails';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RecordCardList from '@/components/ui/RecordCardList';
import RowActions from '@/components/ui/RowActions';
import StatusPill from '@/components/ui/StatusPill';
import { formatDate } from '@/lib/formatDate';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { promoTypeLabel } from '@/app/utils/promotionForm';
import { summariseNames } from '@/app/utils/tableView';
import useConfirmAction from '@/hooks/useConfirmAction';
import usePromotionFilterOptions from '@/hooks/usePromotionFilterOptions';
import usePromotionPage from '@/hooks/usePromotionPage';
import { nextSort } from '@/app/utils/tableView';
import {
  promotionRetailerNames,
  promotionStoreNames,
  promotionStatus,
  promotionStatusLabel,
} from '@/app/utils/promotionOverview';

import { PROMOTION_COLUMNS } from './columns';

// The filter bar's choices; each maps to a GET /api/promotions filter
// (promotionsApi getPromotionPage: storeName -> store).
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
 * The backend filters, searches, sorts and pages (usePromotionPage), one
 * page per request, because promotions grow with every event and store and
 * each row carries its stores and SKUs; this component only keeps the
 * query. The filter choices come from every promotion
 * (usePromotionFilterOptions). `refreshKey` changes when the page knows the
 * list moved (a save or a delete).
 *
 * @param {{
 *   refreshKey: number,
 *   highlightIds?: number[],
 *   editingId?: number | null,
 *   isExpanded: (promotionId: number) => boolean,
 *   onToggle: (promotionId: number) => void,
 *   onEdit: (promotion: object) => void,
 *   onDelete: (promotion: object) => Promise<void>,
 * }} props
 */
export default function PromotionList({
  refreshKey,
  highlightIds = [],
  editingId = null,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
}) {
  const highlighted = new Set(highlightIds);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'period_start', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const deletion = useConfirmAction({ onConfirm: onDelete });
  // Refresh and Retry: the same query asked again.
  const [reloads, setReloads] = useState(0);
  const listKey = `${refreshKey}:${reloads}`;

  const list = usePromotionPage({
    query: {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      search,
      sort: sort.field,
      direction: sort.direction,
      retailer: filters.retailer,
      store: filters.storeName,
      period: filters.period,
      promoType: filters.promoType,
      mechanic: filters.mechanic,
      status: filters.status,
    },
    refreshKey: listKey,
  });
  const { data: options } = usePromotionFilterOptions({ refreshKey: listKey });

  const pageRows = list.data?.promotions ?? [];
  const matching = list.data?.total ?? 0;
  const everything = list.data?.unfiltered_total ?? 0;
  // Read off the page the backend answered with: it moves an offset past the
  // end back to the last page (a delete or a narrower filter shrank the
  // list), and until a new page arrives the old one is still on screen.
  const shownSize = list.data?.limit ?? pageSize;
  const currentPage = list.data ? Math.floor(list.data.offset / shownSize) + 1 : page;
  const totalPages = Math.max(1, Math.ceil(matching / shownSize));

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

  const noMatches = !list.loading && everything > 0 && matching === 0 && (
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PromotionFilters
        filters={filters}
        options={options}
        hasFilters={hasFilters}
        onChange={changeFilter}
        onReset={resetFilters}
      />

      <PaginatedDataTable
        label="Promotion overview"
        noun="promotion"
        totalCount={everything}
        shownCount={matching}
        isLoading={list.loading}
        error={list.error}
        onRefresh={() => setReloads((count) => count + 1)}
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
        pagination={{ page: currentPage, totalPages, pageSize, totalRows: matching, onPageChange: setPage, onPageSizeChange: changePageSize }}
        columns={PROMOTION_COLUMNS}
        minWidth="72rem"
        sort={sort}
        onSort={handleSort}
        emptyState={noMatches || null}
        mobileContent={
          <RecordCardList>
            {pageRows.map((promotion) => {
              const id = promotion.promotion_id;
              const status = promotionStatus(promotion);
              const open = isExpanded(id);
              return (
                <MobileRecordCard
                  key={id}
                  title={summariseNames(promotionRetailerNames(promotion).map(retailerLabel))}
                  subtitle={summariseNames(promotionStoreNames(promotion))}
                  badge={<StatusPill tone={status === 'active' ? 'success' : status === 'upcoming' ? 'info' : 'muted'}>{promotionStatusLabel(status)}</StatusPill>}
                  actions={<RowActions label={`Actions for promotion ${id}`} actions={promotionRowActions(promotion, editingId === id, onEdit, deletion.request)} />}
                  fields={[
                    { label: 'Starts', value: formatDate(promotion.period_start) },
                    { label: 'Ends', value: formatDate(promotion.period_end) },
                    { label: 'Type', value: promoTypeLabel(promotion.promo_type) },
                    { label: 'Mechanic', value: promotion.promotion_mechanic || '—' },
                  ]}
                >
                  <Button variant="link" size="sm" aria-expanded={open} onClick={() => onToggle(id)} className="mt-2 h-auto px-0 text-xs text-deep-violet-blue">
                    {open ? 'Hide details' : 'View details'}
                  </Button>
                  {open && <div className="mt-2 border-t border-lavander/70 pt-2"><PromotionDetails promotion={promotion} /></div>}
                </MobileRecordCard>
              );
            })}
          </RecordCardList>
        }
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
      </PaginatedDataTable>

      <ConfirmDeleteDialog
        promotion={deletion.target}
        isDeleting={deletion.isPending}
        onCancel={deletion.cancel}
        onConfirm={deletion.confirm}
      />
    </div>
  );
}
