'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import DataTable from '@/components/ui/DataTable';
import ExpandableRow from '@/components/ui/ExpandableRow';
import { cardClass } from '@/components/ui/formStyles';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RecordCardList from '@/components/ui/RecordCardList';
import InfoTooltip from '@/components/ui/InfoTooltip';
import StatusPill from '@/components/ui/StatusPill';
import TableGrid, { EXPANDED_ROW_INSET } from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import TablePagination, { PAGE_SIZES } from '@/components/ui/TablePagination';
import TableSearch from '@/components/ui/TableSearch';
import useExpandedRows from '@/hooks/useExpandedRows';
import {
  anchorLine,
  explanationLines,
  filterCalculatedRows,
  levelLabel,
  levelTone,
  skusDiffer,
  upcomingText,
  upliftText,
} from '@/app/utils/promoUpliftCalc';
import { formatMomentCounts, momentCounts } from '@/app/utils/promoUpliftSettings';
import { customerLabel } from '@/app/utils/retailerLabel';
import { formatPct } from '@/app/utils/scenarioPromotions';
import { matchesSearch, paginate } from '@/app/utils/tableView';
import { cn } from '@/lib/utils';

import PromoUpliftFilters from './PromoUpliftFilters';

// Uplifts and anchors follow SKU ranges, so the table filters by range, not SKU.
const NO_FILTERS = { customer: '', skuRange: '', mechanic: '' };

function hinted(label, hint) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTooltip label={`About ${label}`}>{hint}</InfoTooltip>
    </span>
  );
}

const COLUMNS = [
  { key: 'customer', label: 'Customer', width: '11rem' },
  { key: 'range', label: 'SKU range', width: '12rem' },
  { key: 'mechanic', label: 'Mechanic' },
  { key: 'discount', label: 'Discount', width: '6rem', align: 'right' },
  { key: 'uplift', label: 'Uplift', width: '10rem', align: 'right' },
  {
    key: 'basis',
    label: hinted(
      'Basis',
      'How the uplift was worked out: the anchor itself (0%), measured from moments against the current anchor, measured with moments from an earlier anchor converted, or the placeholder rule with fewer than 3 moments. Hover the i for the months used.',
    ),
    width: '17rem',
  },
  {
    key: 'moments',
    label: hinted(
      'Moments',
      'Offline months where this mechanic was the only promotion for the whole month, so its own uplift can be measured. Hover a count for its years.',
    ),
    width: '7.5rem',
    align: 'right',
  },
];

const SKU_COLUMNS = [
  { key: 'product', label: 'SKU' },
  { key: 'uplift', label: 'Uplift', width: '10rem', align: 'right' },
  { key: 'basis', label: 'Basis', width: '17rem' },
];

const tdClass = 'px-4 py-2.5';
const numClass = 'text-right tabular-nums';
const subClass = 'block text-xs font-normal text-deep-violet-blue/50';

// A level's pill with its 'i' card: how the value was reached (anchor
// version, months, conversions, or the placeholder sum).
function Basis({ level, lines }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <StatusPill tone={levelTone(level)}>{levelLabel(level)}</StatusPill>
      <InfoTooltip label={`How ${levelLabel(level)} was worked out`} variant="card" className="w-72">
        {lines.map((line) => (
          <span key={line} className="block">{line}</span>
        ))}
      </InfoTooltip>
    </span>
  );
}

function rangeLines(version) {
  if (!version.skus.length) return [anchorLine(version.anchor)];
  if (!skusDiffer(version)) return explanationLines(version.skus[0], version.anchor);
  return [anchorLine(version.anchor), 'The SKUs in this range differ: open the row to see each one.'];
}

/**
 * Uplift by mechanic: the worked-out uplift per customer x SKU range x
 * mechanic (backend promo_uplift_calc), read-only -- uplifts are never typed.
 * Laid out like the Nomenclatures list (MappingList): the heading and filters
 * in a card, then the shared list-table card (count, search, Refresh/Retry,
 * paging). The value is this month's anchor version, the next version is its
 * second line, and the Basis pill says how it was reached, with an 'i' card.
 * A range whose SKUs differ shows the spread and the least direct level;
 * every row opens to its SKUs. Any change to what is listed goes back to
 * page 1.
 *
 * @param {object} props
 * @param {object[]} props.rows every row from getCalculatedUplifts
 * @param {boolean} props.isLoading
 * @param {string | null} props.error
 * @param {() => void} props.onRefresh
 * @param {Array<{ value: string, label: string }>} props.mechanicOptions
 * @param {{ moments: object[] } | null} props.moments from usePromoMoments
 */
export default function PromoUpliftTable({ rows, isLoading, error, onRefresh, mechanicOptions, moments }) {
  const expanded = useExpandedRows();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const withVersions = rows.filter((row) => row.versions.length);
  const matching = filterCalculatedRows(withVersions, filters).filter((row) =>
    matchesSearch([row.customer_name, row.sku_range, row.mechanic_label], search),
  );
  const { pageRows, currentPage, totalPages } = paginate(matching, page, pageSize);
  const customerNames = [...new Set(withVersions.map((row) => row.customer_name))];
  const skuRanges = [...new Set(withVersions.map((row) => row.sku_range))].sort();
  const hasFilters = Object.values(filters).some(Boolean) || search.trim() !== '';

  const changeFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const changeSearch = (value) => {
    setSearch(value);
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(NO_FILTERS);
    setSearch('');
    setPage(1);
  };

  const changePageSize = (size) => {
    setPageSize(size);
    setPage(1);
  };

  const noMatches = withVersions.length > 0 && matching.length === 0 && (
    <>
      <p>No uplifts match these filters.</p>
      {hasFilters && (
        <Button variant="outline" className="mt-3" onClick={resetFilters}>
          Reset filters
        </Button>
      )}
    </>
  );

  return (
    <>
      <section className={cardClass}>
        <h2 className="mb-2 flex items-center gap-1 text-sm font-medium text-deep-violet-blue">
          Uplift by mechanic
          <InfoTooltip label="About uplift">
            How much more or less a month with this mechanic sells than an ordinary month, worked out from past
            promotions. Used when planning future promotions in the Scenario builder, where it can be edited for one
            scenario.
          </InfoTooltip>
        </h2>
        <PromoUpliftFilters
          filters={filters}
          customers={customerNames}
          skuRangeOptions={skuRanges.map((range) => ({ value: range, label: range }))}
          mechanicOptions={mechanicOptions}
          onChange={changeFilter}
          onReset={resetFilters}
        />
      </section>

      <DataTable
        label="Uplift by mechanic"
        noun="uplift"
        totalCount={withVersions.length}
        shownCount={matching.length}
        isLoading={isLoading}
        error={error}
        onRefresh={onRefresh}
        emptyMessage="No uplifts worked out yet. Use Recalculate to work them out."
        toolbar={
          <TableSearch
            value={search}
            onChange={changeSearch}
            label="Search uplifts"
            placeholder="Search customer, SKU range, mechanic…"
          />
        }
        footer={
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalRows={matching.length}
            onPageChange={setPage}
            onPageSizeChange={changePageSize}
          />
        }
        columns={COLUMNS}
        minWidth="72rem"
        emptyState={noMatches || null}
        mobileContent={
          <RecordCardList>
            {pageRows.map((row) => {
              const [current] = row.versions;
              const upcoming = upcomingText(row);
              const counts = moments ? momentCounts(row, moments.moments) : null;
              return (
                <MobileRecordCard
                  key={`${row.customer_id}:${row.sku_range}:${row.mechanic_key}`}
                  title={row.mechanic_label}
                  subtitle={`${customerLabel(row.customer_name)} · ${row.sku_range}`}
                  badge={<Basis level={current.level} lines={rangeLines(current)} />}
                  fields={[
                    { label: 'Uplift', value: upcoming ? <>{upliftText(current)}<span className={subClass}>{upcoming}</span></> : upliftText(current) },
                    { label: 'Discount', value: row.discount_pct != null ? `${row.discount_pct}%` : '—' },
                    { label: 'Moments', value: counts ? counts.total : '—' },
                  ]}
                >
                  {skusDiffer(current) ? (
                    <ul className="mt-3 grid gap-1.5 border-t border-lavander/70 pt-2 text-xs text-deep-violet-blue">
                      {current.skus.map((sku) => (
                        <li key={sku.sku} className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate">{sku.product_name ?? sku.sku}</span>
                          <span className="inline-flex shrink-0 items-center gap-1.5">
                            <span className="tabular-nums">{sku.uplift_pct != null ? formatPct(sku.uplift_pct) : '—'}</span>
                            <Basis level={sku.level} lines={explanationLines(sku, current.anchor)} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </MobileRecordCard>
              );
            })}
          </RecordCardList>
        }
      >
        {pageRows.map((row) => {
          const key = `${row.customer_id}:${row.sku_range}:${row.mechanic_key}`;
          const [current] = row.versions;
          const upcoming = upcomingText(row);
          const counts = moments ? momentCounts(row, moments.moments) : null;
          const name = customerLabel(row.customer_name);
          const isOpen = expanded.isExpanded(key);
          return (
            <ExpandableRow
              key={key}
              columnCount={COLUMNS.length}
              isOpen={isOpen}
              onToggle={() => expanded.toggle(key)}
              primary={name}
              title={name}
              toggleLabel={
                isOpen
                  ? `Hide SKUs for ${name} · ${row.sku_range} · ${row.mechanic_label}`
                  : `Show SKUs for ${name} · ${row.sku_range} · ${row.mechanic_label}`
              }
              details={
                <TableGrid variant="nested" columns={SKU_COLUMNS} inset={EXPANDED_ROW_INSET} minWidth="40rem">
                  {current.skus.map((sku) => (
                    <TableRow key={sku.sku} className="h-11 border-b border-lavander/80 last:border-b-0">
                      <td className={cn(tdClass, 'truncate')} title={`${sku.product_name ?? ''} · ${sku.sku}`}>
                        {sku.product_name ?? sku.sku}
                        <span className={subClass}>{sku.sku}</span>
                      </td>
                      <td className={cn(tdClass, numClass)}>
                        {sku.uplift_pct != null ? formatPct(sku.uplift_pct) : '—'}
                      </td>
                      <td className={tdClass}>
                        <Basis level={sku.level} lines={explanationLines(sku, current.anchor)} />
                      </td>
                    </TableRow>
                  ))}
                </TableGrid>
              }
            >
              <td className={cn(tdClass, 'truncate')} title={row.sku_range}>{row.sku_range}</td>
              <td className={cn(tdClass, 'truncate font-medium')} title={row.mechanic_label}>{row.mechanic_label}</td>
              <td className={cn(tdClass, numClass)}>{row.discount_pct != null ? `${row.discount_pct}%` : '—'}</td>
              <td className={cn(tdClass, numClass)}>
                {upliftText(current)}
                {upcoming ? <span className={subClass}>{upcoming}</span> : null}
              </td>
              <td className={tdClass}>
                <Basis level={current.level} lines={rangeLines(current)} />
              </td>
              <td className={cn(tdClass, numClass)}>
                {counts ? <span title={formatMomentCounts(counts)}>{counts.total}</span> : '—'}
              </td>
            </ExpandableRow>
          );
        })}
      </DataTable>
    </>
  );
}
