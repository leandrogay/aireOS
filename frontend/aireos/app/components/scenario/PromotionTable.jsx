'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ExpandableRow from '@/components/ui/ExpandableRow';
import PaginatedDataTable from '@/components/ui/PaginatedDataTable';
import RowActions from '@/components/ui/RowActions';
import StatusPill from '@/components/ui/StatusPill';
import { Switch } from '@/components/ui/switch';
import TableGrid, { ACTIONS_COLUMN } from '@/components/ui/TableGrid';
import { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableRow from '@/components/ui/TableRow';
import TableSearch from '@/components/ui/TableSearch';
import PromotionUpliftDetails from './PromotionUpliftDetails';
import useExpandedRows from '@/hooks/useExpandedRows';
import { customersLabel } from '@/app/utils/retailerLabel';
import { PROMO_OVERLAY_TYPES } from '@/app/utils/forecastView';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';
import { formatPctRange, hasUnsavedPromotionChanges, promotionScopeLabel, voucherUpliftPct } from '@/app/utils/scenarioPromotions';
import { promotionUpliftDetails } from '@/app/utils/promotionUpliftDetails';
import { savedScenarioItems } from '@/app/utils/scenarioSavedItems';
import { nextSort, paginate } from '@/app/utils/tableView';
import { formatDateRange } from '@/lib/formatDateRange';

const COLUMNS = [
  { key: 'mechanic', label: 'Promotion', sortField: 'mechanicLabel', width: '13rem' },
  { key: 'customers', label: 'Customers', width: '10rem' },
  { key: 'ranges', label: 'SKU ranges', width: '11rem' },
  { key: 'dates', label: 'Active dates', sortField: 'startMonth', width: '10rem' },
  { key: 'uplift', label: 'Uplift used', width: '10rem' },
  { key: 'gain', label: 'Gain in chart', width: '10rem' },
  { key: 'active', label: 'Active', width: '5rem' },
  ACTIONS_COLUMN,
];

function units(value) {
  return Math.round(value).toLocaleString('en-US');
}

function signed(value) {
  return `${value < 0 ? '−' : '+'}${units(Math.abs(value))}`;
}

function dates(promotion) {
  return promotion.startDate ? formatDateRange(promotion.startDate, promotion.endDate)
    : monthSpanLabel([promotion.startMonth, promotion.endMonth]);
}

function Details({ promotion, months, uplifts, baseLabel }) {
  return (
    <div className="grid gap-4 text-xs md:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <p className="whitespace-pre-line">{promotion.explanation || 'No explanation added'}</p>
        <p className="text-deep-violet-blue/60">Use Edit to change the scope, voucher or customer × SKU range switches.</p>
        <PromotionUpliftDetails rows={uplifts} overridden={promotion.overrideUpliftPct != null} />
      </div>
      <div className="min-w-0">
        <p className="mb-2 font-semibold text-deep-violet-blue/70">Impact in the selected chart view</p>
        {months.length ? (
          <TableGrid variant="nested" minWidth="24rem" columns={[
            { key: 'month', label: 'Month' }, { key: 'base', label: baseLabel, align: 'right' },
            { key: 'with', label: 'Base + this change', align: 'right' }, { key: 'gain', label: 'Gain', align: 'right' },
          ]}>
            {months.map((month) => (
              <TableRow key={month.month_year}>
                <td className="px-3 py-2">{monthSpanLabel([month.month_year])}</td>
                <td className="px-3 py-2 text-right tabular-nums">{units(month.baseUnits)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{units(month.baseUnits + month.deltaUnits)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-scenario-ink">{signed(month.deltaUnits)}</td>
              </TableRow>
            ))}
          </TableGrid>
        ) : <p className="text-deep-violet-blue/60">{promotion.isActive ? 'Not applied in the current chart view.' : 'Switch it on to preview its impact.'}</p>}
      </div>
    </div>
  );
}

/** All saved promotions in this mode, independently of chart filters; the sidebar is their editor. */
export default function PromotionTable({ items, editor, impacts, monthsByItem, liveIndex, onEdit, onRefresh,
  isLoading, error, baseLabel = 'Current', previewReady = true, showNotice = true }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'startMonth', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const expanded = useExpandedRows();
  const allSaved = savedScenarioItems(items);
  const matching = savedScenarioItems(items, search).sort((a, b) =>
    String(a[sort.field] ?? '').localeCompare(String(b[sort.field] ?? '')) * (sort.direction === 'asc' ? 1 : -1));
  const { pageRows, currentPage, totalPages } = paginate(matching, page, pageSize);
  const busy = editor.saving || editor.togglingIds.length > 0 || editor.deletion.isPending;
  const target = editor.deletion.target;
  return (
    <div className="space-y-2">
      {showNotice && editor.notice ? <p role="status" className="text-xs text-deep-violet-blue/70">{editor.notice}</p> : null}
      <PaginatedDataTable label="Saved scenario promotions" title="Saved promotions" noun="promotion"
        totalCount={allSaved.length} shownCount={matching.length} isLoading={isLoading}
        error={editor.error ?? error} onRefresh={() => { editor.clearError(); onRefresh?.(); }}
        emptyMessage="No saved promotions yet. Use Add promotion in the sidebar."
        toolbar={<TableSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }}
          label="Search saved promotions" placeholder="Search mechanic, customer, SKU range…" />}
        columns={COLUMNS} minWidth="73rem" sort={sort}
        onSort={(field) => { setSort((current) => nextSort(current, field)); setPage(1); }}
        pagination={{ page: currentPage, totalPages, pageSize, totalRows: matching.length,
          onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); } }}
        emptyState={allSaved.length && !matching.length ? (
          <><p>No promotions match this search.</p><Button variant="outline" className="mt-2" onClick={() => setSearch('')}>Clear search</Button></>
        ) : null}>
        {pageRows.map((promotion) => {
          const editing = editor.selected?.id === promotion.id;
          const dirty = hasUnsavedPromotionChanges(promotion);
          const uplifts = promotionUpliftDetails(promotion, { liveIndex, upliftsByCustomer: editor.uplifts.data });
          const impact = promotion.isActive ? impacts.get(promotion.id) : null;
          const uplift = uplifts.length ? formatPctRange(uplifts.map((row) => row.appliedPct + voucherUpliftPct(promotion, row.customer, row.product))) : 'Unavailable';
          const type = PROMO_OVERLAY_TYPES.find((option) => option.value === promotion.promoType)?.label ?? promotion.promoType;
          return (
            <ExpandableRow key={promotion.id} columnCount={COLUMNS.length} isOpen={expanded.isExpanded(promotion.id)}
              onToggle={() => expanded.toggle(promotion.id)} highlight={editing ? 'editing' : null}
              primary={<span className="grid gap-0.5"><span>{promotion.mechanicLabel}</span>
                <span className="text-[11px] font-normal text-deep-violet-blue/60">{type}</span>
                {dirty ? <StatusPill tone="info">Unsaved edits</StatusPill> : null}</span>}
              toggleLabel={`${expanded.isExpanded(promotion.id) ? 'Hide' : 'Show'} details for ${promotion.mechanicLabel}`}
              actions={<RowActions label={`Actions for ${promotion.mechanicLabel}`} actions={[
                { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => onEdit(promotion), disabledReason: busy ? 'Saving changes' : editing ? 'Editing now' : undefined },
                { key: 'delete', label: 'Delete', icon: Trash2, destructive: true, onSelect: () => editor.requestDelete(promotion), disabledReason: busy ? 'Saving changes' : undefined },
              ]} />}
              details={<Details promotion={promotion} months={monthsByItem.get(promotion.id) ?? []} uplifts={uplifts} baseLabel={baseLabel} />}>
              <td className="truncate px-4 py-2.5" title={customersLabel(promotion.customers)}>{customersLabel(promotion.customers)}</td>
              <td className="truncate px-4 py-2.5" title={promotionScopeLabel(promotion)}>{promotionScopeLabel(promotion)}</td>
              <td className="px-4 py-2.5 text-xs tabular-nums">{dates(promotion)}</td>
              <td className="px-4 py-2.5 tabular-nums">{uplift}{promotion.voucher ? <span className="block text-[11px] text-deep-violet-blue/60">Includes voucher</span> : null}</td>
              <td className="px-4 py-2.5 tabular-nums">{impact ? <span className="font-semibold text-scenario-ink">{signed(impact.deltaUnits)} units</span>
                : <span className="text-xs text-deep-violet-blue/50">{!promotion.isActive ? 'Off' : previewReady ? 'Not applied in chart view' : 'Preview unavailable'}</span>}</td>
              <td className="px-4 py-2.5" onClick={(event) => event.stopPropagation()}>
                <Switch checked={promotion.isActive} disabled={busy || dirty}
                  onCheckedChange={(checked) => editor.toggleSaved(promotion, checked)}
                  title={dirty ? 'Save or discard edits in the sidebar first.' : undefined}
                  aria-label={`${promotion.isActive ? 'Take off' : 'Show on'} the Simulated line: ${promotion.mechanicLabel}`}
                  className="data-checked:bg-switch-on-scenario" />
              </td>
            </ExpandableRow>
          );
        })}
      </PaginatedDataTable>
      <ConfirmDialog open={Boolean(target)} title="Delete this saved promotion?"
        description="It will be removed from this plan. Switch it off to keep it without applying it."
        details={target ? [{ label: 'Mechanic', value: target.mechanicLabel }, { label: 'Customers', value: customersLabel(target.customers) },
          { label: 'SKU ranges', value: promotionScopeLabel(target) }, { label: 'Active dates', value: dates(target) }] : undefined}
        confirmLabel="Delete promotion" pendingLabel="Deleting…" tone="destructive"
        isPending={editor.deletion.isPending} onConfirm={editor.deletion.confirm} onCancel={editor.deletion.cancel} />
    </div>
  );
}
