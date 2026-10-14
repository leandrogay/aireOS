'use client';

import { useState } from 'react';
import { PencilLine } from 'lucide-react';

import { cn } from '@/lib/utils';
import ChartLoading from '@/components/ui/ChartLoading';
import ForecastChart from '@/components/forecast/ForecastChart';
import ForecastFilters from '@/components/forecast/ForecastFilters';
import BuildingBlocksSection from '@/components/scenario/BuildingBlocksSection';
import DraftSwitcher from '@/components/scenario/DraftSwitcher';
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
  forecastMonths,
  itemMarkers,
  simulate,
  simulatedYearTotals,
  withSimulatedLine,
} from '@/app/utils/scenarioEngine';
import { impactRows, monthSpanLabel, pitchMetrics, seasonalAverage } from '@/app/utils/scenarioPitch';
import { draftPromotionBands } from '@/app/utils/scenarioPromotions';
import { SCENARIO_SOURCES } from '@/app/utils/scenarioSources';
import useForecastFilters from '@/hooks/useForecastFilters';
import useForecastView from '@/hooks/useForecastView';
import useForecastYearTotals from '@/hooks/useForecastYearTotals';
import useScenarioDraft from '@/hooks/useScenarioDraft';

/**
 * The Scenario builder workspace (blueprint Part 4): the same filters and
 * chart as /forecast, with the selected Forecast Draft simulated on top, a
 * pitch summary underneath and the building blocks panel on the right.
 *
 * Shared file: it owns the state and the layout slots. Everything it shows
 * is calculated by the pure scenario utils from the forecast rows and the
 * draft; nothing here is written back to the server.
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
  const { drafts, draft, selectDraft, renameDraft, setBlocks, setPromotions } = useScenarioDraft();
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

  // useScenarioDraft reads sessionStorage in its initial state, so nothing
  // draft-specific may render until after hydration. The options arrive by
  // fetch, so waiting for them guarantees that.
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

  const { byMonth, byItem } = simulate(rows, draft, SCENARIO_SOURCES);
  const scenario = {
    series: [SIMULATED_SERIES],
    markers: itemMarkers(byItem),
    promoBands: draftPromotionBands(draft.promotions),
    seasonalAverage: seasonalAverage(basePoints),
    simulatedYears: simulatedYearTotals(years, byMonth),
  };
  const metrics = pitchMetrics(unitPoints, revenuePoints, byMonth);
  const itemRows = impactRows(draft, SCENARIO_SOURCES, byItem);
  const months = forecastMonths(rows);
  const itemCount = draft.blocks.length + draft.promotions.length;
  const error = filters.error ?? view.error;

  const customerText = customerName ? retailerLabel(customerName) : 'All customers';
  const scopeTags = [
    { label: 'SKU', value: productName || 'All SKUs' },
    { label: 'Customer', value: customerText },
    { label: 'Draft', value: draft.name || 'Untitled' },
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-scenario-soft px-3 py-2 text-xs text-scenario-ink">
          <PencilLine className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Sandbox: changes to <b>{draft.name || 'this draft'}</b> show here only. The Current forecast, Inventory
            and Dashboard stay as they are.
          </span>
        </p>
        <DraftSwitcher drafts={drafts} activeId={draft.id} onSelect={selectDraft} />
      </div>

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
            draftName={draft.name || 'Untitled'}
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
          draftName={draft.name}
          onRenameDraft={renameDraft}
          blocksSection={
            <BuildingBlocksSection key={draft.id} items={draft.blocks} onChange={setBlocks} {...sectionProps} />
          }
          promotionsSection={
            <PromotionsSection key={draft.id} items={draft.promotions} onChange={setPromotions} {...sectionProps} />
          }
        />
      </div>
    </div>
  );
}
