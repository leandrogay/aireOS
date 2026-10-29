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
import ModelViewToggle from '@/components/scenario/ModelViewToggle';
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
import {
  MODEL_VIEWS,
  OFFICIAL_REFERENCE_SERIES,
  modelPromotionSummary,
  rowsForView,
  withOfficialReference,
} from '@/app/utils/scenarioModelView';
import { activeScenarioPromotions, draftPromotionBands } from '@/app/utils/scenarioPromotions';
import {
  activeScenarioBlocks,
  hasUnsavedChanges,
  updateScenarioBlock,
} from '@/app/utils/scenarioBlocks';
import { SCENARIO_SOURCES } from '@/app/utils/scenarioSources';
import useForecastAlternatives from '@/hooks/useForecastAlternatives';
import useForecastFilters from '@/hooks/useForecastFilters';
import useForecastView from '@/hooks/useForecastView';
import useForecastYearTotals from '@/hooks/useForecastYearTotals';
import useConfirmAction from '@/hooks/useConfirmAction';
import useExpandedRows from '@/hooks/useExpandedRows';
import useScenarioBlocks from '@/hooks/useScenarioBlocks';
import useScenarioPromotions from '@/hooks/useScenarioPromotions';
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
  const [visibleSeries, setVisibleSeries] = useState({
    ...ALL_SERIES_VISIBLE,
    [SIMULATED_SERIES.key]: true,
    [OFFICIAL_REFERENCE_SERIES.key]: true,
  });
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [modelView, setModelView] = useState(MODEL_VIEWS.official);
  const view = useForecastView({ ready, productName, customerName, startDate, endDate });
  const { rows: officialRows, actuals, promotions, freshness } = view.data;

  // Months whose official forecast already includes the promotion entered
  // for them can be swapped for the forecast without it, so planned
  // promotions are never counted twice (app/utils/scenarioModelView.js).
  // Only for one customer and one SKU: across several, the months mix models
  // and the toggle would be too hard to read. Greyed out when that SKU has no
  // such month.
  const showViewToggle = Boolean(productName && customerName);
  const modelSummary = modelPromotionSummary(officialRows);
  const canSwitchView = showViewToggle && modelSummary.modelMonths > 0;
  const activeView = canSwitchView ? modelView : MODEL_VIEWS.official;
  const alternatives = useForecastAlternatives({
    enabled: ready && canSwitchView && activeView === MODEL_VIEWS.planned,
    productName,
    customerName,
  });
  const mapRows = (forecastRows) => rowsForView(forecastRows, alternatives.data, activeView);
  const rows = mapRows(officialRows);
  const scenarioBlocks = useScenarioBlocks();
  // Planned promotions: saved like blocks (hooks/useScenarioPromotions.js).
  const scenarioPromotions = useScenarioPromotions();
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
    rows: officialRows,
    actuals,
    mapRows,
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
  const swapped = rows !== officialRows;
  const officialPoints = swapped
    ? buildMonthlyPoints(officialRows, actuals, metric === 'revenue' ? 'revenue' : 'units', { singleSeries })
    : null;
  const viewPoints = metric === 'revenue' ? revenuePoints : unitPoints;
  const basePoints = swapped ? withOfficialReference(viewPoints, officialPoints) : viewPoints;

  // Only switched-on blocks and promotions count, on the chart and in the tables.
  const allBlocks = scenarioBlocks.blocks;
  const activePromotions = activeScenarioPromotions(scenarioPromotions.promotions);
  const counted = { blocks: activeScenarioBlocks(allBlocks), promotions: activePromotions };
  const { cells, byMonth, byItem } = simulate(rows, counted, SCENARIO_SOURCES, chartView(filters, splitBasis.basis));
  // Nothing simulated until a switched-on item changes something in view:
  // no Simulated line, legend entry or table columns before that.
  const hasSimulated = byItem.size > 0;
  const monthCells = cellsByMonth(cells);
  // Promotions have no name of their own; their mechanic stands in.
  const names = new Map([
    ...allBlocks.map((block) => [block.id, block.name]),
    ...scenarioPromotions.promotions.map((promotion) => [promotion.id, promotion.mechanicLabel]),
  ]);
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
    // Simulated stays first: the chart takes its colour from series[0]. The
    // grey Official reference only shows in the Simulate New Promotions view.
    series: [...(hasSimulated ? [SIMULATED_SERIES] : []), ...(swapped ? [OFFICIAL_REFERENCE_SERIES] : [])],
    markers: hasSimulated ? itemMarkers(byItem) : [],
    promoBands: draftPromotionBands(activePromotions),
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
  const itemCount = allBlocks.length + scenarioPromotions.promotions.length;
  const error =
    filters.error ?? view.error ?? scenarioBlocks.error ?? scenarioPromotions.error ?? splitBasis.error ?? actionError;

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
            : 'min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] min-[1100px]:items-stretch'
        )}
      >
        {/* Side by side, the chart card and the panel end at the same height:
            the row is as tall as the taller one and the chart card stretches. */}
        <div className="min-w-0 space-y-1 min-[1100px]:flex min-[1100px]:flex-col min-[1100px]:[&>[data-slot=card]]:flex-1">
          {showViewToggle ? (
            <ModelViewToggle
              value={activeView}
              onChange={setModelView}
              disabled={!canSwitchView}
              summary={modelSummary}
              loading={alternatives.loading}
              error={alternatives.error}
            />
          ) : null}

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

        {/* Side by side, the open panel takes exactly the chart card's height
            (absolute, inset-0) instead of setting the row's, so both end level
            whatever the tab or the chart view. Each tab scrolls on its own under
            the fixed tab buttons, and overscroll-contain stops a scroll that
            reaches a tab's end from carrying on into the page. */}
        <div
          className={cn(
            'relative min-w-0',
            panelCollapsed
              ? null
              : 'min-[1100px]:[&>aside]:absolute min-[1100px]:[&>aside]:inset-0 min-[1100px]:[&_[data-slot=tabs]]:h-full min-[1100px]:[&_[data-slot=tabs-content]]:min-h-0 min-[1100px]:[&_[data-slot=tabs-content]]:overflow-y-auto min-[1100px]:[&_[data-slot=tabs-content]]:overscroll-contain min-[1100px]:[&_[data-slot=tabs-content]]:pr-1'
          )}
        >
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
            scenarioPromotions.loading ? (
              <p className="text-xs text-deep-violet-blue/60">Loading promotions…</p>
            ) : (
              <PromotionsSection
                items={scenarioPromotions.promotions}
                onChange={scenarioPromotions.setPromotions}
                onSave={scenarioPromotions.savePromotion}
                onDelete={scenarioPromotions.deletePromotion}
                rows={rows}
                {...sectionProps}
              />
            )
          }
        />
        </div>
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
