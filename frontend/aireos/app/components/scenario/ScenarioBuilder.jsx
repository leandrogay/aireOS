'use client';

import { useState } from 'react';
import { PencilLine } from 'lucide-react';

import { cn } from '@/lib/utils';
import ChartLoading from '@/components/ui/ChartLoading';
import ForecastChart from '@/components/forecast/ForecastChart';
import ForecastFilters from '@/components/forecast/ForecastFilters';
import BuildingBlocksSection from '@/components/scenario/BuildingBlocksSection';
import PitchSummaryCard from '@/components/scenario/PitchSummaryCard';
import PromotionsSection from '@/components/scenario/PromotionsSection';
import ScenarioPanel from '@/components/scenario/ScenarioPanel';
import { retailerLabel } from '@/app/utils/retailerLabel';
import {
  ALL_PACK_TYPE_VALUES,
  ALL_PROMO_TYPE_VALUES,
  ALL_SERIES_VISIBLE,
  buildMonthlyPoints,
  toggleSelectedValue,
  toggleSeriesVisibility,
} from '@/app/utils/forecastView';
import {
  SIMULATED_SERIES,
  chartView,
  forecastMonths,
  itemMarkers,
  simulate,
  simulatedYearTotals,
  withSimulatedLine,
} from '@/app/utils/scenarioEngine';
import { impactRows, monthSpanLabel, pitchMetrics, seasonalAverage } from '@/app/utils/scenarioPitch';
import { draftPromotionBands } from '@/app/utils/scenarioPromotions';
import { activeScenarioBlocks } from '@/app/utils/scenarioBlocks';
import { SCENARIO_SOURCES } from '@/app/utils/scenarioSources';
import useForecastFilters from '@/hooks/useForecastFilters';
import useForecastView from '@/hooks/useForecastView';
import useForecastYearTotals from '@/hooks/useForecastYearTotals';
import useScenarioBlocks from '@/hooks/useScenarioBlocks';

/**
 * The Scenario builder workspace (blueprint Part 4): the same filters and
 * chart as /forecast, with the switched-on building blocks (and draft
 * promotions) simulated on top, a pitch summary underneath and the panel on
 * the right.
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

  // Only switched-on blocks count, on the chart and in the pitch summary.
  const counted = { blocks: activeScenarioBlocks(scenarioBlocks.blocks), promotions: draftPromotions };
  const { byMonth, byItem } = simulate(rows, counted, SCENARIO_SOURCES, chartView(filters));
  const scenario = {
    series: [SIMULATED_SERIES],
    markers: itemMarkers(byItem),
    promoBands: draftPromotionBands(draftPromotions),
    seasonalAverage: seasonalAverage(basePoints),
    simulatedYears: simulatedYearTotals(years, byMonth),
  };
  const metrics = pitchMetrics(unitPoints, revenuePoints, byMonth);
  const itemRows = impactRows(counted, SCENARIO_SOURCES, byItem);
  const months = forecastMonths(rows);
  const itemCount = scenarioBlocks.blocks.length + draftPromotions.length;
  const error = filters.error ?? view.error ?? scenarioBlocks.error;

  const customerText = customerName ? retailerLabel(customerName) : 'All customers';
  const scopeTags = [
    { label: 'SKU', value: productName || 'All SKUs' },
    { label: 'Customer', value: customerText },
  ];
  const scope = `${productName || 'All SKUs'} · ${customerText} · ${monthSpanLabel([startDate, endDate].map((date) => `${date.slice(0, 7)}-01`))}`;

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
      <p className="flex items-center gap-2 rounded-md bg-scenario-soft px-3 py-2 text-xs text-scenario-ink">
        <PencilLine className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Sandbox: building blocks only move the dashed <b>Simulated</b> line, so you can compare it with the
          Current forecast. The Current forecast, Inventory and Dashboard stay as they are.
        </span>
      </p>

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
          <ForecastFilters
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

          <ForecastChart
            points={withSimulatedLine(basePoints, byMonth, metric)}
            startDate={startDate}
            endDate={endDate}
            metric={metric}
            onMetricChange={setMetric}
            singleSeries={singleSeries}
            scopeTags={scopeTags}
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
            loading={view.loading}
            scenario={scenario}
          />

          <PitchSummaryCard
            scope={scope}
            metrics={metrics}
            rows={itemRows}
            metric={metric}
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
                items={scenarioBlocks.blocks}
                onChange={scenarioBlocks.setBlocks}
                onSave={scenarioBlocks.saveBlock}
                onDelete={scenarioBlocks.deleteBlock}
                {...sectionProps}
              />
            )
          }
          promotionsSection={
            <PromotionsSection items={draftPromotions} onChange={setDraftPromotions} {...sectionProps} />
          }
        />
      </div>
    </div>
  );
}
