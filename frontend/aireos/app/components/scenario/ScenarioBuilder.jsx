'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';
import ChartLoading from '@/components/ui/ChartLoading';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ForecastChart from '@/components/forecast/ForecastChart';
import ForecastFilters from '@/components/forecast/ForecastFilters';
import { mixCaption } from '@/components/forecast/ForecastYearTotals';
import BlockTable from '@/components/scenario/BlockTable';
import BuildingBlocksSection from '@/components/scenario/BuildingBlocksSection';
import ImpactStrip from '@/components/scenario/ImpactStrip';
import MonthlyPlan from '@/components/scenario/MonthlyPlan';
import PromotionsSection from '@/components/scenario/PromotionsSection';
import ScenarioPanel from '@/components/scenario/ScenarioPanel';
import ScenarioTotals from '@/components/scenario/ScenarioTotals';
import ScenarioYearComparison from '@/components/scenario/ScenarioYearComparison';
import { retailerLabel } from '@/app/utils/retailerLabel';
import {
  ALL_PACK_TYPE_VALUES,
  ALL_PROMO_TYPE_VALUES,
  ALL_SERIES_VISIBLE,
  buildMonthlyPoints,
  sumHorizonForecast,
  toggleSelectedValue,
  toggleSeriesVisibility,
} from '@/app/utils/forecastView';
import {
  SIMULATED_SERIES,
  cellsByMonth,
  chartView,
  forecastMonths,
  itemMarkers,
  simulate,
  simulatedYearTotals,
  splitBasisNeeds,
  withSimulatedLine,
} from '@/app/utils/scenarioEngine';
import { monthSpanLabel, pitchMetrics, seasonalAverage } from '@/app/utils/scenarioPitch';
import { draftPromotionBands } from '@/app/utils/scenarioPromotions';
import {
  activeScenarioBlocks,
  hasUnsavedChanges,
  updateScenarioBlock,
} from '@/app/utils/scenarioBlocks';
import { SCENARIO_SOURCES } from '@/app/utils/scenarioSources';
import useForecastFilters from '@/hooks/useForecastFilters';
import useForecastView from '@/hooks/useForecastView';
import useForecastYearTotals from '@/hooks/useForecastYearTotals';
import useConfirmAction from '@/hooks/useConfirmAction';
import useExpandedRows from '@/hooks/useExpandedRows';
import useScenarioBlocks from '@/hooks/useScenarioBlocks';
import useUnitsSplitBasis from '@/hooks/useUnitsSplitBasis';

// Distinct items with cells in any of these months.
function itemsInMonths(monthCells, months) {
  const ids = new Set();
  for (const month of months) {
    for (const id of monthCells.get(month)?.keys() ?? []) ids.add(id);
  }
  return ids.size;
}

/**
 * The Scenario builder workspace (blueprint Part 4): the same filters and
 * chart as /forecast, with the switched-on building blocks (and draft
 * promotions) simulated on top. The chart card holds the filters, the
 * impact summary and a Current-vs-Simulated table; saved blocks are listed
 * in a table under it; the panel on the right creates and edits them.
 *
 * Shared file: it owns the state and the layout slots. Everything it shows
 * is calculated by the pure scenario utils from the forecast rows and the
 * items. Saving a block never changes the Current forecast: only the
 * Simulated line reads them.
 */
export default function ScenarioBuilder() {
  const filters = useForecastFilters();
  const { productName, customerName, startDate, endDate, ready } = filters;
  const [metric, setMetric] = useState('units');
  const [selectedPromoTypes, setSelectedPromoTypes] = useState(ALL_PROMO_TYPE_VALUES);
  const [selectedPackTypes, setSelectedPackTypes] = useState(ALL_PACK_TYPE_VALUES);
  const [visibleSeries, setVisibleSeries] = useState({ ...ALL_SERIES_VISIBLE, [SIMULATED_SERIES.key]: true });
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const view = useForecastView({ ready, productName, customerName, startDate, endDate });
  const { rows, actuals, promotions, freshness } = view.data;
  const scenarioBlocks = useScenarioBlocks();
  // Draft promotions are the promotions side's to save; until then they live
  // in this page's memory only.
  const [draftPromotions, setDraftPromotions] = useState([]);
  // The block open in the panel's editor (a draft, or a saved block opened
  // from the table with Edit); its months are banded on the chart.
  const [selectedId, setSelectedId] = useState(null);
  const [newIds, setNewIds] = useState([]);
  const [togglingIds, setTogglingIds] = useState([]);
  const [actionError, setActionError] = useState(null);
  const expandedRows = useExpandedRows();
  const deletion = useConfirmAction({ onConfirm: deleteSaved });

  // Called by the confirm dialog; catches its own errors (useConfirmAction).
  async function deleteSaved(block) {
    setActionError(null);
    try {
      await scenarioBlocks.deleteBlock(block);
      setSelectedId((current) => (current === block.id ? null : current));
    } catch (err) {
      setActionError(`Couldn't delete ${block.name}: ${err.message}`);
    }
  }
  const { years, loading: yearTotalsLoading } = useForecastYearTotals({
    ready,
    productName,
    customerName,
    startDate,
    endDate,
    bounds: filters.bounds,
    rows,
    actuals,
  });
  // Units blocks the filters only partly show (an All SKUs block while one
  // SKU is picked) are split over rows fetched for their whole scope.
  const splitBasis = useUnitsSplitBasis({
    ready,
    needs: splitBasisNeeds(activeScenarioBlocks(scenarioBlocks.blocks), chartView(filters)),
  });

  if (!ready) {
    return filters.error ? (
      <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue">
        {filters.error}
      </p>
    ) : (
      <ChartLoading
        label="Loading forecast…"
        className="h-[40vh] min-h-[230px] rounded-xl border border-lavander bg-white"
      />
    );
  }

  const singleSeries = Boolean(productName && customerName);
  const unitPoints = buildMonthlyPoints(rows, actuals, 'units', { singleSeries });
  const revenuePoints = buildMonthlyPoints(rows, actuals, 'revenue', { singleSeries });
  const basePoints = metric === 'revenue' ? revenuePoints : unitPoints;

  // Only switched-on blocks count, on the chart and in the tables.
  const allBlocks = scenarioBlocks.blocks;
  const counted = { blocks: activeScenarioBlocks(allBlocks), promotions: draftPromotions };
  const { cells, byMonth, byItem } = simulate(rows, counted, SCENARIO_SOURCES, chartView(filters, splitBasis.basis));
  // Nothing simulated until a switched-on block changes something in view:
  // no Simulated line, legend entry or table columns before that.
  const hasSimulated = byItem.size > 0;
  const monthCells = cellsByMonth(cells);
  const names = new Map([...allBlocks, ...draftPromotions].map((item) => [item.id, item.name]));
  const monthItems = new Map(
    [...monthCells].map(([month, items]) => [
      month,
      [...items].map(([itemId, totals]) => ({ itemId, name: names.get(itemId) ?? '', ...totals })),
    ])
  );
  const monthsByItem = new Map();
  for (const [month, items] of [...monthCells].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [itemId, totals] of items) {
      if (!monthsByItem.has(itemId)) monthsByItem.set(itemId, []);
      monthsByItem.get(itemId).push({ month_year: month, ...totals });
    }
  }

  // The panel holds drafts, saved blocks with unsaved edits (not ones the
  // table is saving a switch for) and the saved block opened with Edit.
  const savedBlocks = allBlocks.filter((block) => block.saved);
  const panelBlocks = allBlocks.filter(
    (block) =>
      !block.saved ||
      block.id === selectedId ||
      (hasUnsavedChanges(block) && !togglingIds.includes(block.id))
  );
  const selectedBlock = panelBlocks.find((block) => block.id === selectedId) ?? panelBlocks[0] ?? null;

  const simulatedYears = simulatedYearTotals(years, byMonth);
  const scenario = {
    series: hasSimulated ? [SIMULATED_SERIES] : [],
    markers: hasSimulated ? itemMarkers(byItem) : [],
    promoBands: draftPromotionBands(draftPromotions),
    seasonalAverage: seasonalAverage(basePoints),
    simulatedYears: hasSimulated ? simulatedYears : [],
    monthItems,
    selectedBand:
      selectedBlock && byItem.has(selectedBlock.id)
        ? { startMonth: selectedBlock.startMonth, endMonth: selectedBlock.endMonth, label: selectedBlock.name }
        : null,
  };
  const metrics = pitchMetrics(unitPoints, revenuePoints, byMonth);
  const yearShares = simulatedYears
    .filter((year) => year.deltaUnits || year.deltaRevenue)
    .map((year) => {
      const base = years.find((item) => item.year === year.year);
      return {
        year: year.year,
        unitsPct: base?.volume.total ? year.deltaUnits / base.volume.total : null,
        revenuePct: base?.revenue.total ? year.deltaRevenue / base.revenue.total : null,
      };
    });

  // Comparison table rows: each year in view, then the next 12 months (the
  // months the Current line covers).
  const horizonMonths = basePoints.filter((point) => point.current != null).map((point) => point.month_year);
  const deltaKey = metric === 'revenue' ? 'deltaRevenue' : 'deltaUnits';
  const comparisonRows = [
    ...simulatedYears.map((year) => {
      const base = years.find((item) => item.year === year.year);
      const yearMonths = [...monthCells.keys()].filter((month) => month.slice(0, 4) === year.year);
      return {
        key: year.year,
        label: year.year,
        caption: base ? mixCaption(base) : '',
        current: metric === 'revenue' ? base?.revenue.total ?? null : base?.volume.total ?? null,
        delta: year[deltaKey] ?? 0,
        blocks: itemsInMonths(monthCells, yearMonths),
      };
    }),
    ...(horizonMonths.length
      ? [
          {
            key: 'next-12',
            label: 'Next 12 months',
            current: sumHorizonForecast(basePoints),
            delta: horizonMonths.reduce((total, month) => total + (byMonth.get(month)?.[deltaKey] ?? 0), 0),
            blocks: itemsInMonths(monthCells, horizonMonths),
          },
        ]
      : []),
  ];

  const months = forecastMonths(rows);
  const itemCount = allBlocks.length + draftPromotions.length;
  const error = filters.error ?? view.error ?? scenarioBlocks.error ?? splitBasis.error ?? actionError;

  const customerText = customerName ? retailerLabel(customerName) : 'All customers';

  async function savePanelBlock(block) {
    await scenarioBlocks.saveBlock(block);
    // Saved: it moves to the table, marked new, and the panel lets it go.
    setNewIds((current) => [...current, block.id]);
    setSelectedId((current) => (current === block.id ? null : current));
  }

  // The table's switch saves straight away; on failure the block goes back
  // to how it was and the reason shows above the page.
  async function toggleSaved(block, isActive) {
    const next = updateScenarioBlock(block, { isActive });
    setActionError(null);
    setTogglingIds((current) => [...current, block.id]);
    scenarioBlocks.setBlocks((current) => current.map((item) => (item.id === block.id ? next : item)));
    try {
      await scenarioBlocks.saveBlock(next);
    } catch (err) {
      scenarioBlocks.setBlocks((current) => current.map((item) => (item.id === block.id ? block : item)));
      setActionError(`Couldn't ${isActive ? 'switch on' : 'switch off'} ${block.name}: ${err.message}`);
    } finally {
      setTogglingIds((current) => current.filter((id) => id !== block.id));
    }
  }

  function editSaved(block) {
    setSelectedId(block.id);
    setPanelCollapsed(false);
  }

  // From the monthly plan: open a block (draft promotions aren't edited
  // here) in the panel.
  function openItem(itemId) {
    const block = allBlocks.find((item) => item.id === itemId);
    if (block) editSaved(block);
  }

  const sectionProps = {
    customerOptions: filters.customerOptions,
    productOptions: filters.productOptions,
    months,
    defaultCustomer: customerName,
    defaultSku: productName,
    impacts: byItem,
  };

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue">
          {error}
        </p>
      )}

      <div
        className={cn(
          'grid items-start gap-2',
          panelCollapsed
            ? 'min-[1100px]:grid-cols-[minmax(0,1fr)_56px]'
            : 'min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]'
        )}
      >
        <div className="min-w-0 space-y-1">
          <ForecastChart
            points={hasSimulated ? withSimulatedLine(basePoints, byMonth, metric) : basePoints}
            startDate={startDate}
            endDate={endDate}
            metric={metric}
            onMetricChange={setMetric}
            singleSeries={singleSeries}
            scopeTags={[]}
            toolbar={
              <ForecastFilters
                variant="toolbar"
                productName={productName}
                onProductNameChange={filters.setProductName}
                productOptions={filters.productOptions}
                customerName={customerName}
                onCustomerNameChange={filters.setCustomerName}
                customerOptions={filters.customerOptions}
                startDate={startDate}
                endDate={endDate}
                onStartDateChange={filters.setStartDate}
                onEndDateChange={filters.setEndDate}
                minDate={filters.bounds.start}
                maxDate={filters.bounds.end}
                onClearFilters={filters.clear}
                canClearFilters={filters.canClear}
              />
            }
            summary={<ImpactStrip metrics={metrics} years={yearShares} loading={view.loading} />}
            yearTable={
              <ScenarioTotals
                singleSeries={singleSeries}
                yearTable={
                  <ScenarioYearComparison
                    metric={metric}
                    rows={comparisonRows}
                    loading={yearTotalsLoading || view.loading}
                  />
                }
                monthlyPlan={
                  <MonthlyPlan
                    ready={ready}
                    productName={productName}
                    customerName={customerName}
                    startDate={startDate}
                    endDate={endDate}
                    rows={rows}
                    actuals={actuals}
                    byMonth={byMonth}
                    monthItems={monthItems}
                    onOpenItem={openItem}
                    scope={`${customerText} · ${productName || 'All SKUs'}`}
                  />
                }
              />
            }
            promotions={promotions}
            selectedPromoTypes={selectedPromoTypes}
            onTogglePromoType={(value) => setSelectedPromoTypes((current) => toggleSelectedValue(current, value))}
            selectedPackTypes={selectedPackTypes}
            onTogglePackType={(value) => setSelectedPackTypes((current) => toggleSelectedValue(current, value))}
            visibleSeries={visibleSeries}
            onToggleSeries={(key) => setVisibleSeries((current) => toggleSeriesVisibility(current, key))}
            lastRun={freshness.current_generated_at}
            salesLabel={customerName ? `${customerText} sales` : 'All customers sales'}
            salesLoadedAt={freshness.latest_sales_loaded_at}
            confidence={null}
            yearTotals={years}
            yearTotalsLoading={yearTotalsLoading}
            horizonVolume={sumHorizonForecast(unitPoints)}
            horizonRevenue={sumHorizonForecast(revenuePoints)}
            loading={view.loading}
            scenario={scenario}
          />

        </div>

        <ScenarioPanel
          collapsed={panelCollapsed}
          onCollapsedChange={setPanelCollapsed}
          itemCount={itemCount}
          blocksSection={
            scenarioBlocks.loading ? (
              <p className="text-xs text-deep-violet-blue/60">Loading building blocks…</p>
            ) : (
              <BuildingBlocksSection
                items={panelBlocks}
                savedCount={savedBlocks.length}
                selectedId={selectedBlock?.id ?? null}
                onSelect={setSelectedId}
                onChange={scenarioBlocks.setBlocks}
                onSave={savePanelBlock}
                onRequestDelete={deletion.request}
                onClose={() => setSelectedId(null)}
                {...sectionProps}
              />
            )
          }
          promotionsSection={
            <PromotionsSection items={draftPromotions} onChange={setDraftPromotions} {...sectionProps} />
          }
        />
      </div>

      <BlockTable
        blocks={savedBlocks}
        view={chartView(filters)}
        impacts={byItem}
        monthsByItem={monthsByItem}
        metric={metric}
        isLoading={scenarioBlocks.loading}
        editingId={selectedBlock?.saved ? selectedBlock.id : null}
        newIds={newIds}
        togglingIds={togglingIds}
        isExpanded={expandedRows.isExpanded}
        onToggleRow={expandedRows.toggle}
        onToggleActive={toggleSaved}
        onEdit={editSaved}
        onDelete={deletion.request}
        onClearFilters={filters.clear}
      />

      <ConfirmDialog
        open={Boolean(deletion.target)}
        title="Delete this building block?"
        description="It will be removed for good. To keep it but take it off the chart, switch it off instead."
        details={
          deletion.target
            ? [
                { label: 'Block', value: deletion.target.name },
                {
                  label: 'Applies to',
                  value: `${retailerLabel(deletion.target.customer)} · ${deletion.target.sku || 'All SKUs'}`,
                },
                {
                  label: 'Months',
                  value: monthSpanLabel([deletion.target.startMonth, deletion.target.endMonth].filter(Boolean)),
                },
              ]
            : undefined
        }
        confirmLabel="Delete block"
        pendingLabel="Deleting…"
        tone="destructive"
        isPending={deletion.isPending}
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
      />
    </div>
  );
}
