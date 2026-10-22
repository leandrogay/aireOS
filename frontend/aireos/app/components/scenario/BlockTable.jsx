'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import DataTable from '@/components/ui/DataTable';
import ExpandableRow from '@/components/ui/ExpandableRow';
import RowActions from '@/components/ui/RowActions';
import TablePagination, { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import { Switch } from '@/components/ui/switch';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { upliftLabel } from '@/app/utils/scenarioBlocks';
import { monthSpanLabel } from '@/app/utils/scenarioPitch';
import { matchesSearch, nextSort, paginate } from '@/app/utils/tableView';

import { blockColumns } from './columns';

function wholeUnits(value) {
  return Math.round(value).toLocaleString('en-US');
}

function wholeDollars(value) {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function signed(value, format) {
  return `${value < 0 ? '−' : '+'}${format(Math.abs(value))}`;
}

function monthLabel(monthYear) {
  return monthSpanLabel([monthYear]);
}

/**
 * True when the page's filters show this block: its customer (or All
 * customers), its SKU (an All SKUs block shows for any one SKU too, since
 * it applies to it), and any month of it inside the period. Overlap, not
 * containment: a block reaching past the period still belongs in the list.
 */
export function blockInView(block, view) {
  if (view.customerName && view.customerName !== block.customer) return false;
  if (view.productName && block.sku && view.productName !== block.sku) return false;
  if (view.startMonth && block.endMonth < view.startMonth) return false;
  if (view.endMonth && block.startMonth > view.endMonth) return false;
  return true;
}

function sortBlocks(blocks, field, direction) {
  const sign = direction === 'asc' ? 1 : -1;
  return [...blocks].sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * sign);
}

function BlockDetails({ block, months, metric }) {
  const format = metric === 'revenue' ? wholeDollars : wholeUnits;
  return (
    <div className="grid gap-4 text-xs md:grid-cols-2">
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">Explanation</p>
        <p className="whitespace-pre-line leading-relaxed">{block.explanation || '—'}</p>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-deep-violet-blue/60">
          By month · {metric === 'revenue' ? 'revenue' : 'volume'}
        </p>
        {months.length ? (
          <table className="tabular-nums">
            <thead>
              <tr className="text-[11px] text-deep-violet-blue/60">
                <th className="py-0.5 pr-4 text-left font-normal">Month</th>
                <th className="py-0.5 pr-4 text-right font-normal">Current</th>
                <th className="py-0.5 pr-4 text-right font-normal">Simulated</th>
                <th className="py-0.5 text-right font-normal">Gain</th>
              </tr>
            </thead>
            <tbody>
              {months.map((month) => {
                const base = metric === 'revenue' ? month.baseRevenue : month.baseUnits;
                const delta = metric === 'revenue' ? month.deltaRevenue : month.deltaUnits;
                return (
                  <tr key={month.month_year}>
                    <td className="py-0.5 pr-4">{monthLabel(month.month_year)}</td>
                    <td className="py-0.5 pr-4 text-right">{format(base)}</td>
                    <td className="py-0.5 pr-4 text-right">{format(base + delta)}</td>
                    <td className="py-0.5 text-right font-semibold text-scenario-ink">{signed(delta, format)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
 * Promotions uses. Rows follow the page's Customer / SKU / Period filters
 * (`view`), plus a search over name and explanation. Each row shows what the block
 * adds while it is switched on; the switch saves straight away. Edit opens
 * the block in the side panel; Delete asks first (`onDelete` is the page's
 * confirm request). The row open in the panel is marked as editing.
 *
 * @param {{
 *   blocks: object[],                 saved blocks
 *   view: ReturnType<import('@/app/utils/scenarioEngine').chartView>,
 *   impacts: Map<string, { deltaUnits: number, deltaRevenue: number }>,
 *   monthsByItem: Map<string, object[]>,
 *   metric: 'units' | 'revenue',
 *   isLoading: boolean,
 *   error?: string,
 *   editingId: string | null,
 *   newIds: string[],
 *   togglingIds: string[],
 *   isExpanded: (id: string) => boolean,
 *   onToggleRow: (id: string) => void,
 *   onToggleActive: (block: object, isActive: boolean) => void,
 *   onEdit: (block: object) => void,
 *   onDelete: (block: object) => void,
 *   onClearFilters: () => void,
 * }} props
 */
export default function BlockTable({
  blocks,
  view,
  impacts,
  monthsByItem,
  metric,
  isLoading,
  error = '',
  editingId,
  newIds,
  togglingIds,
  isExpanded,
  onToggleRow,
  onToggleActive,
  onEdit,
  onDelete,
  onClearFilters,
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'startMonth', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const showCustomer = !view.customerName;
  const columns = blockColumns(showCustomer);
  const inView = blocks.filter((block) => blockInView(block, view));
  const matching = inView.filter((block) => matchesSearch([block.name, block.explanation], search));
  const sorted = sortBlocks(matching, sort.field, sort.direction);
  const { pageRows, currentPage, totalPages } = paginate(sorted, page, pageSize);

  const noMatches = !isLoading && blocks.length > 0 && sorted.length === 0 && (
    <>
      <p>No building blocks match these filters.</p>
      <Button
        variant="outline"
        className="mt-3"
        onClick={() => {
          setSearch('');
          setPage(1);
          onClearFilters();
        }}
      >
        Reset filters
      </Button>
    </>
  );

  return (
    <DataTable
      label="Building blocks"
      noun="building block"
      totalCount={blocks.length}
      shownCount={sorted.length}
      isLoading={isLoading}
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
      footer={
        <TablePagination
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalRows={sorted.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      }
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
        const sku = block.sku || 'All SKUs';
        const appliesTo = showCustomer ? `${retailerLabel(block.customer)} · ${sku}` : sku;
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
            highlight={isEditing ? 'editing' : newIds.includes(block.id) ? 'new' : null}
            primary={block.name}
            title={block.name}
            toggleLabel={isExpanded(block.id) ? `Hide details for ${block.name}` : `Show details for ${block.name}`}
            actions={<RowActions label={`Actions for ${block.name}`} actions={actions} />}
            details={<BlockDetails block={block} months={monthsByItem.get(block.id) ?? []} metric={metric} />}
          >
            <td className="truncate px-4 py-2.5" title={appliesTo}>{appliesTo}</td>
            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
              {monthSpanLabel([block.startMonth, block.endMonth].filter(Boolean))}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{upliftLabel(block)}</td>
            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
              {impact ? (
                <span className="block leading-tight text-scenario-ink">
                  <span className="block font-semibold">{signed(impact.deltaUnits, wholeUnits)} units</span>
                  <span className="block text-[11px]">{signed(impact.deltaRevenue, wholeDollars)}</span>
                </span>
              ) : (
                <span className="text-deep-violet-blue/45">{block.isActive ? 'Outside chart filters' : 'Off'}</span>
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
                className="data-checked:bg-scenario"
              />
            </td>
          </ExpandableRow>
        );
      })}
    </DataTable>
  );
}
