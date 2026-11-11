'use client';

import { useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { Button } from '@/components/ui/button';
import HeaderCheckboxFilter from '@/components/ui/HeaderCheckboxFilter';
import MobileRecordCard from '@/components/ui/MobileRecordCard';
import RecordCardList from '@/components/ui/RecordCardList';
import TableCard from '@/components/ui/TableCard';
import TableCardHeader, { TABLE_HEADER_BUTTON_CLASS } from '@/components/ui/TableCardHeader';
import TableGrid from '@/components/ui/TableGrid';
import TableRow from '@/components/ui/TableRow';
import { cn } from '@/lib/utils';
import { TABLE_ROWS } from '@/app/config/transitions';
import useAnimatedHeight from '@/hooks/useAnimatedHeight';
import useMediaQuery from '@/hooks/useMediaQuery';
import {
  TABLE_MISSING_HINT,
  TABLE_MISSING_LABEL,
  TABLE_PARTIAL_HINT,
  TABLE_PARTIAL_LABEL,
} from '@/app/utils/forecastLineText';
import { FORECAST_SERIES, uniqueMonthOptions } from '@/app/utils/forecastView';

const NO_MATCHES = 'No rows match these table filters.';

// Collapsed, the table and the phone cards show this much and scroll inside.
const COLLAPSED_TABLE = '28vh';
const COLLAPSED_CARDS = '55vh';

// Cartons, whole numbers.
function formatTableValue(value) {
  if (value == null) return '—';
  return Math.round(value).toLocaleString();
}

/**
 * One cell's value. A month whose sales file is missing reads "Missing"
 * (muted), never "—" or 0; a partly reported month keeps its sum with a
 * muted "partial" (forecastActuals.actualKind).
 */
function CellValue({ point, seriesKey }) {
  if (seriesKey === 'actual' && point.actualKind === 'missing') {
    return (
      <span className="text-deep-violet-blue/45" title={TABLE_MISSING_HINT}>
        {TABLE_MISSING_LABEL}
      </span>
    );
  }
  const value = formatTableValue(point[seriesKey]);
  if (seriesKey === 'actual' && point.actualKind === 'partial') {
    return (
      <span title={TABLE_PARTIAL_HINT}>
        {value} <span className="text-[10px] text-deep-violet-blue/45">{TABLE_PARTIAL_LABEL}</span>
      </span>
    );
  }
  return value;
}

/**
 * Month-by-month values of the lines on the chart, for the model the chart
 * shows (`modelLabel`, e.g. "Tier 0 · Baseline"): `points` are already that
 * one tier's (utils/forecastTiers.js), so the table has no per-month model.
 *
 * @param {{ points: object[], visibleSeries: Record<string, boolean>, modelLabel?: string }} props
 */
export default function ForecastTable({ points, visibleSeries, modelLabel = '' }) {
  const [monthFilter, setMonthFilter] = useState([]);
  // The phone view's Month filter, above the cards (the table's is in its header).
  const [openMobileFilter, setOpenMobileFilter] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const mobile = useMediaQuery('(max-width: 639px)');
  const reduceMotion = useReducedMotion();
  // The phone cards' box eases open and shut like the table (TableGrid
  // animateHeight + maxHeight).
  const { frameRef: cardsFrameRef, contentRef: cardsContentRef, height: cardsHeight } = useAnimatedHeight({
    enabled: mobile && !reduceMotion,
    transition: TABLE_ROWS.glide,
    maxHeight: expanded ? null : COLLAPSED_CARDS,
  });
  const monthOptions = uniqueMonthOptions(points);
  const visibleColumns = FORECAST_SERIES.filter((series) => visibleSeries[series.key]);

  const validMonths = new Set(monthOptions.map((option) => option.value));
  const activeMonthFilter = monthFilter.filter((value) => validMonths.has(value));
  const rows = activeMonthFilter.length
    ? points.filter((point) => activeMonthFilter.includes(point.month_year))
    : points;

  const columns = [
    {
      key: 'month',
      label: 'Month',
      width: '16%',
      filter: { selected: activeMonthFilter, options: monthOptions, onChange: setMonthFilter },
    },
    ...visibleColumns.map((series) => ({ key: series.key, label: series.label, align: 'right' })),
  ];

  return (
    <TableCard
      variant="glass"
      label="Monthly forecast values"
      header={(
        <TableCardHeader
          title="Monthly values"
          detail={<>{rows.length} of {points.length} months shown{modelLabel ? ` · ${modelLabel}` : ''}</>}
          actions={(
            <>
              {/* Phones have no column headings, so the Month filter sits
                  here; it clears from its own list, as in the table header. */}
              {mobile && (
                <HeaderCheckboxFilter
                  id="month-mobile"
                  label="Month"
                  selected={activeMonthFilter}
                  options={monthOptions}
                  openId={openMobileFilter}
                  setOpenId={setOpenMobileFilter}
                  onChange={setMonthFilter}
                />
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                aria-label={expanded ? 'Collapse monthly values' : 'Show every month'}
                title={expanded ? 'Collapse' : 'Show every month'}
                className={cn('shrink-0', TABLE_HEADER_BUTTON_CLASS)}
              >
                {expanded ? <ChevronsDownUp aria-hidden="true" /> : <ChevronsUpDown aria-hidden="true" />}
              </Button>
            </>
          )}
        />
      )}
    >
      {mobile ? (
        <motion.div
          ref={cardsFrameRef}
          style={cardsHeight ? { height: cardsHeight } : expanded ? undefined : { maxHeight: COLLAPSED_CARDS }}
          // Scrolls while collapsed; expanded, held to its cards' height.
          className={cn('border-t border-lavander bg-cream/25', expanded ? 'overflow-y-hidden' : 'overflow-y-auto')}
          aria-label="Monthly forecast values"
        >
          <div ref={cardsContentRef} className="p-3">
            {rows.length === 0 ? (
              <p className="rounded-lg border border-lavander bg-white p-6 text-center text-sm text-deep-violet-blue/70">{NO_MATCHES}</p>
            ) : (
              <RecordCardList>
                {rows.map((point) => (
                  <MobileRecordCard
                    key={point.month_year}
                    title={point.label}
                    fields={visibleColumns.map((series) => ({
                      label: series.label,
                      value: <span className="tabular-nums"><CellValue point={point} seriesKey={series.key} /></span>,
                    }))}
                  />
                ))}
              </RecordCardList>
            )}
          </div>
        </motion.div>
      ) : (
        // Collapsed, the rows scroll under the sticky header; Expand eases the
        // table open to every month. The row-flex wrapper is DataTable's: as a
        // direct child of the card's column, TableGrid's flex-1 would size it
        // to its rows and override the eased height.
        <div className="flex min-h-0">
          <TableGrid
            columns={columns}
            minWidth="56rem"
            emptyState={rows.length === 0 ? NO_MATCHES : null}
            animateHeight
            maxHeight={expanded ? null : COLLAPSED_TABLE}
          >
            {rows.map((point) => (
              <TableRow key={point.month_year} className="h-12 border-b border-lavander/80">
                <td className="px-4 py-2.5 font-medium">{point.label}</td>
                {visibleColumns.map((series) => (
                  <td key={series.key} className="px-4 py-2.5 text-right tabular-nums">
                    <CellValue point={point} seriesKey={series.key} />
                  </td>
                ))}
              </TableRow>
            ))}
          </TableGrid>
        </div>
      )}
    </TableCard>
  );
}
