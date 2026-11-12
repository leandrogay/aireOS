'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import PaginatedDataTable from '@/components/ui/PaginatedDataTable';
import ExpandableRow from '@/components/ui/ExpandableRow';
import RowActions from '@/components/ui/RowActions';
import TableGrid from '@/components/ui/TableGrid';
import { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import { Switch } from '@/components/ui/switch';
import TableRow from '@/components/ui/TableRow';
import { customersLabel } from '@/app/utils/retailerLabel';
import { blockScopeLabel, upliftLabel } from '@/app/utils/scenarioBlocks';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';
import { nextSort, paginate } from '@/app/utils/tableView';
import { savedScenarioItems } from '@/app/utils/scenarioSavedItems';

import ItemPairs from './ItemPairs';
import { blockColumns } from './columns';

function wholeUnits(value) {
  return Math.round(value).toLocaleString('en-US');
}

function signed(value, format) {
  return `${value < 0 ? '−' : '+'}${format(Math.abs(value))}`;
}

function monthLabel(monthYear) {
  return monthSpanLabel([monthYear]);
}

function sortBlocks(blocks, field, direction) {
  const sign = direction === 'asc' ? 1 : -1;
  return [...blocks].sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * sign);
}

function BlockDetails({ block, months, pairs, toggling, onTogglePair, baseLabel }) {
  return (
    <div className="grid gap-4 text-xs md:grid-cols-[minmax(0,1fr)_minmax(24rem,1.2fr)]">
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">Explanation</p>
        <p className="whitespace-pre-line leading-relaxed">{block.explanation || '—'}</p>
        <div className="mt-3">
          <ItemPairs
            pairs={pairs}
            active={block.isActive}
            disabled={toggling}
            onToggle={(customer, skuRange, on) => onTogglePair(block, customer, skuRange, on)}
          />
        </div>
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
          By month · volume
        </p>
        {months.length ? (
          <TableGrid
            variant="nested"
            minWidth="24rem"
            columns={[
              { key: 'month', label: 'Month' },
              { key: 'current', label: baseLabel, align: 'right' },
              { key: 'simulated', label: 'Simulated', align: 'right' },
              { key: 'gain', label: 'Gain', align: 'right' },
            ]}
          >
            {months.map((month) => (
              <TableRow key={month.month_year} className="h-9 border-b border-lavander/80 last:border-b-0">
                <td className="px-3 py-2">{monthLabel(month.month_year)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{wholeUnits(month.baseUnits)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{wholeUnits(month.baseUnits + month.deltaUnits)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-scenario-ink">
                  {signed(month.deltaUnits, wholeUnits)}
                </td>
              </TableRow>
            ))}
          </TableGrid>
        ) : (
          <p className="text-deep-violet-blue/60">
            {block.isActive ? 'Outside chart filters' : 'Switch it on to see what it adds each month.'}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Saved building blocks, under the chart, in the shared list-table card
 * Promotions uses. All saved blocks in the mode remain visible, with local
 * search independent of chart filters. Each row shows what the block
 * adds while it is switched on; the switch saves straight away. Edit opens
 * the block in the side panel; Delete asks first (`onDelete` is the page's
 * confirm request). The row open in the panel is marked as editing.
 *
 * @param {{
 *   blocks: object[],                 saved blocks
 *   impacts: Map<string, { deltaUnits: number }>,
 *   monthsByItem: Map<string, object[]>,
 *   isLoading: boolean,
 *   error?: string,
 *   editingId: string | null,
 *   togglingIds: string[],
 *   isExpanded: (id: string) => boolean,
 *   onToggleRow: (id: string) => void,
 *   onToggleActive: (block: object, isActive: boolean) => void,
 *   pairsFor: (block: object) => ReturnType<typeof import('@/app/utils/scenarioEngine').itemPairs>,
 *   onTogglePair: (block: object, customer: string, skuRange: string | null, on: boolean) => void,
 *   onEdit: (block: object) => void,
 *   onDelete: (block: object) => void,
 *   onRefresh?: () => void,
 *   baseLabel?: string,
 *   closedIds?: Set<string>,          blocks whose months all have actual sales
 * }} props
 */
export default function BlockTable({
  blocks,
  impacts,
  monthsByItem,
  isLoading,
  error = '',
  editingId,
  togglingIds,
  isExpanded,
  onToggleRow,
  onToggleActive,
  pairsFor,
  onTogglePair,
  onEdit,
  onDelete,
  onRefresh,
  baseLabel = 'Current',
  closedIds = new Set(),
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'startMonth', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const showCustomer = true;
  const columns = blockColumns(showCustomer);
  const matching = savedScenarioItems(blocks, search);
  const sorted = sortBlocks(matching, sort.field, sort.direction);
  const { pageRows, currentPage, totalPages } = paginate(sorted, page, pageSize);

  const noMatches = !isLoading && blocks.length > 0 && sorted.length === 0 && (
    <>
      <p>No building blocks match this search.</p>
      <Button
        variant="outline"
        className="mt-3"
        onClick={() => {
          setSearch('');
          setPage(1);
        }}
      >
        Clear search
      </Button>
    </>
  );

  return (
    <PaginatedDataTable
      label="Building blocks"
      title="Saved building blocks"
      noun="building block"
      totalCount={blocks.length}
      shownCount={sorted.length}
      isLoading={isLoading}
      onRefresh={onRefresh}
      error={error}
      emptyMessage="No saved building blocks yet. Use Add building block to create one."
      toolbar={
        <TableSearch
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label="Search building blocks"
          placeholder="Search name, explanation…"
        />
      }
      pagination={{ page: currentPage, totalPages, pageSize, totalRows: sorted.length, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); } }}
      columns={columns}
      minWidth="62rem"
      sort={sort}
      onSort={(field) => {
        setSort((current) => nextSort(current, field));
        setPage(1);
      }}
      emptyState={noMatches || null}
    >
      {pageRows.map((block) => {
        const impact = block.isActive ? impacts.get(block.id) : null;
        const isEditing = editingId === block.id;
        const toggling = togglingIds.includes(block.id);
        const sku = blockScopeLabel(block);
        // With one customer in view, a block that also covers others still says so.
        const appliesTo =
          showCustomer || block.customers?.length !== 1 ? `${customersLabel(block.customers)} · ${sku}` : sku;
        const actions = [
          {
            key: 'edit',
            label: 'Edit',
            icon: Pencil,
            onSelect: () => onEdit(block),
            disabledReason: isEditing ? 'Editing now' : undefined,
          },
          { key: 'delete', label: 'Delete', icon: Trash2, destructive: true, onSelect: () => onDelete(block) },
        ];
        return (
          <ExpandableRow
            key={block.id}
            columnCount={columns.length}
            isOpen={isExpanded(block.id)}
            onToggle={() => onToggleRow(block.id)}
            highlight={isEditing ? 'editing' : null}
            primary={block.name}
            title={block.name}
            toggleLabel={isExpanded(block.id) ? `Hide details for ${block.name}` : `Show details for ${block.name}`}
            actions={<RowActions label={`Actions for ${block.name}`} actions={actions} />}
            details={
              <BlockDetails
                block={block}
                months={monthsByItem.get(block.id) ?? []}
                pairs={pairsFor(block)}
                toggling={toggling}
                onTogglePair={onTogglePair}
                baseLabel={baseLabel}
              />
            }
          >
            <td className="truncate px-4 py-2.5" title={appliesTo}>{appliesTo}</td>
            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
              {monthSpanLabel([block.startMonth, block.endMonth].filter(Boolean))}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{upliftLabel(block)}</td>
            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
              {impact ? (
                <span className="font-semibold text-scenario-ink">{signed(impact.deltaUnits, wholeUnits)} units</span>
              ) : (
                <span className="text-deep-violet-blue/45">
                  {!block.isActive ? 'Off' : closedIds.has(block.id) ? 'Milestone' : 'Outside chart filters'}
                </span>
              )}
            </td>
            <td className="px-4 py-2.5" title={block.explanation || undefined}>
              <span
                className={block.explanation ? 'block truncate' : 'block truncate italic text-deep-violet-blue/45'}
              >
                {block.explanation || 'No explanation added'}
              </span>
            </td>
            <td className="px-4 py-2.5" onClick={(event) => event.stopPropagation()}>
              <Switch
                checked={block.isActive}
                disabled={toggling}
                onCheckedChange={(checked) => onToggleActive(block, checked)}
                aria-label={`${block.isActive ? 'Take off the Simulated line' : 'Show on the Simulated line'}: ${block.name}`}
                className="data-checked:bg-switch-on-scenario"
              />
            </td>
          </ExpandableRow>
        );
      })}
    </PaginatedDataTable>
  );
}
