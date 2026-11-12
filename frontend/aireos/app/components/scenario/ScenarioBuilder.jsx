'use client';

import { useState } from 'react';

import BudgetLockControl from '@/components/scenario/BudgetLockControl';
import { budgetVersionKey, budgetVersionSeries, initialBudgetRows, initialSplitProblem, withBudgetPoints } from '@/app/utils/budgetPlanning';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ForecastChart from '@/components/forecast/ForecastChart';
import ForecastFilters from '@/components/forecast/ForecastFilters';
import { mixCaption } from '@/components/forecast/ForecastYearTotals';
import BlockTable from '@/components/scenario/BlockTable';
import BuildingBlocksSection from '@/components/scenario/BuildingBlocksSection';
import GrowthControl from '@/components/scenario/GrowthControl';
import MonthlyPlan from '@/components/scenario/MonthlyPlan';
import PromotionsSection from '@/components/scenario/PromotionsSection';
import PromotionTable from '@/components/scenario/PromotionTable';
import ScenarioBuilderSkeleton from '@/components/scenario/ScenarioBuilderSkeleton';
import ScenarioPanel from '@/components/scenario/ScenarioPanel';
import ScenarioTotals from '@/components/scenario/ScenarioTotals';
import ScenarioYearComparison from '@/components/scenario/ScenarioYearComparison';
import FrozenBaselinePanel, { COMPOSITION_LAYERS } from '@/components/scenario/FrozenBaselinePanel';
import Tier0Details from '@/components/scenario/Tier0Details';
import { customerColor, customerPalette, NO_CUSTOMER_COLOR } from '@/app/utils/customerColors';
import { FORECAST_TIER_OPTIONS } from '@/app/utils/forecastLineText';
import { DEFAULT_TIER } from '@/app/utils/forecastTiers';
import { customerLabel, customersLabel } from '@/app/utils/retailerLabel';
import {
  ALL_PACK_TYPE_VALUES,
  ALL_PROMO_TYPE_VALUES,
  ALL_SERIES_VISIBLE,
  FORECAST_SERIES,
  buildMonthlyPoints,
  sumHorizonForecast,
  toggleSelectedValue,
} from '@/app/utils/forecastView';
import {
  SIMULATED_SERIES,
  cellsByMonth,
  chartView,
  coversCustomer,
  forecastMonths,
  itemCustomers,
  itemMarkers,
  itemPairs,
  simulate,
  simulatedYearTotals,
  splitBasisNeeds,
  withPairSwitched,
  withSimulatedLine,
} from '@/app/utils/scenarioEngine';
import { monthSpanLabel, seasonalAverage } from '@/app/utils/scenarioPitch';
import {
  activeScenarioPromotions,
  draftPromotionBands,
  hasUnsavedPromotionChanges,
  withLiveIndex,
} from '@/app/utils/scenarioPromotions';
import { liveUpliftIndex } from '@/app/utils/scenarioLiveUplifts';
import { breakdownTotals, withComposition } from '@/app/utils/scenarioComposition';
import { milestoneBreakdown } from '@/app/utils/scenarioMilestones';
import { OFFICIAL_ITEM, bigChange, monthSplit, tier0SplitIndex } from '@/app/utils/scenarioTier0Split';
import { anchorInMonth, anchorLabel, anchorSourceLabel, anchorTargets } from '@/app/utils/promoUpliftSettings';
import {
  activeScenarioBlocks,
  blockScopeLabel,
  hasUnsavedChanges,
  updateScenarioBlock,
} from '@/app/utils/scenarioBlocks';
import { growthYears, isGrowthBlock } from '@/app/utils/scenarioGrowth';
import { SCENARIO_SOURCES } from '@/app/utils/scenarioSources';
import useAllCustomers from '@/hooks/useAllCustomers';
import useForecastFilters from '@/hooks/useForecastFilters';
import useForecastView from '@/hooks/useForecastView';
import useForecastYearTotals from '@/hooks/useForecastYearTotals';
import usePromoAnchors from '@/hooks/usePromoAnchors';
import usePromoUpliftCalc from '@/hooks/usePromoUpliftCalc';
import useBudgetVersions from '@/hooks/useBudgetVersions';
import useConfirmAction from '@/hooks/useConfirmAction';
import useExpandedRows from '@/hooks/useExpandedRows';
import useScenarioBlocks from '@/hooks/useScenarioBlocks';
import useScenarioPromotions from '@/hooks/useScenarioPromotions';
import useScenarioPromotionEditor from '@/hooks/useScenarioPromotionEditor';
import useTier0Breakdown from '@/hooks/useTier0Breakdown';
import useUnitsSplitBasis from '@/hooks/useUnitsSplitBasis';

// Its own key, so the Forecast page's range (this year) and this page's
// (next year) don't overwrite each other.
const SCENARIO_DATE_SESSION_KEY = 'aireos.scenario.dateRange';
// Same label as the Forecast page's Model dropdown.
const MODEL_LABEL = FORECAST_TIER_OPTIONS.find((option) => option.value === DEFAULT_TIER)?.label ?? '';

// Whether an item on the line is saved, never saved (a draft), or saved
// with unsaved edits -- the line shows what is on screen, not what is saved.
function itemState(item, isPromotion) {
  if (!item.saved) return 'draft';
  const edited = isPromotion ? hasUnsavedPromotionChanges(item) : hasUnsavedChanges(item);
  return edited ? 'edited' : 'saved';
}

// True when a switched-on item is for what the chart shows (a customer it
// covers, and its SKU or all SKUs) and runs at some point from `first` to `last`.
function itemInView(item, filters, first, last) {
  if (!itemCustomers(item) || !item.startMonth || !item.endMonth) return false;
  if (filters.customerName && !coversCustomer(item, filters.customerName)) return false;
  if (filters.productName && item.sku && filters.productName !== item.sku) return false;
  // An all-ranges item counts for any range in view; a ranges item only for its own.
  if (filters.skuRange && item.skuRanges?.length && !item.skuRanges.includes(filters.skuRange)) return false;
  return item.startMonth <= last && item.endMonth >= first;
}

// The switched-on items in a table row, so it can say what makes up its
// Simulated figure ("1 saved + 1 draft", and per item on hover): those
// changing these months, with their units, then those that run in the row's
// period for the chart's customer and SKU but change nothing (`notCounted`:
// their months have actual sales by now), so a saved block never quietly
// disappears from the count.
function itemsInMonths(monthCells, months, itemInfo, { activeItems, filters, first, last }) {
  const units = new Map();
  for (const month of months) {
    for (const [id, totals] of monthCells.get(month) ?? []) {
      units.set(id, (units.get(id) ?? 0) + totals.deltaUnits);
    }
  }
  const counting = [...units].map(([id, deltaUnits]) => ({ id, ...itemInfo.get(id), deltaUnits }));
  const idle = activeItems
    .filter((item) => !units.has(item.id) && itemInView(item, filters, first, last))
    .map((item) => ({ id: item.id, ...itemInfo.get(item.id), deltaUnits: 0, notCounted: true }));
  return { items: [...counting, ...idle] };
}

// What each source changes over `months`, for the By year table's part
// columns: { official, carried, growth, blocks, promotions } in units, adding
// up to the row's Δ.
function partsInMonths(monthCells, months) {
  const parts = { official: 0, carried: 0, growth: 0, blocks: 0, promotions: 0 };
  for (const month of months) {
    for (const totals of monthCells.get(month)?.values() ?? []) {
      if (totals.source in parts) parts[totals.source] += totals.deltaUnits;
    }
  }
  return parts;
}

/**
 * The Scenario builder workspace (blueprint Part 4): the same filters and
 * chart as /forecast, with the switched-on building blocks (and draft
 * promotions) simulated on top. The chart card holds the filters, the
 * impact summary and a Current-vs-Simulated table; saved blocks are listed
 * in a table under it; the panel on the right creates and edits them.
 *
 * Always built on Tier 0 (the baseline: half the same month last year, half
 * the recent run-rate, no growth and no promotions), so a planned promotion
 * is measured against the customer's usual discount and never against a
 * promotion the model already holds. Opens on next year, the year being
 * planned; the budget's growth (next year = Tier 0 x (1 + g)) is set in the
 * Breakdown tab and saved as a growth block (scenarioGrowth.js).
 *
 * Shared file: it owns the state and the layout slots. Everything it shows
 * is calculated by the pure scenario utils from the forecast rows and the
 * items. Saving a block never changes the Current forecast: only the
 * Simulated line reads them.
 */
export default function ScenarioBuilder({ plan = 'scenario', budgetYear, onBudgetRestarted } = {}) {
  const budget = plan === 'budget';
  // Current forecast opens on this year (the hook's default); Budget planning on the budget year.
  const filters = useForecastFilters({ defaultRange: budget ? () => ({ start: `${budgetYear}-01-01`, end: `${budgetYear}-12-01` }) : undefined, sessionKey: `${SCENARIO_DATE_SESSION_KEY}.${plan}${budget ? `.${budgetYear}` : ''}` });
  // Planned by SKU range, not SKU: the filter, blocks and growth all follow
  // ranges. productName stays '' here (promotions still pick one SKU).
  const { productName, skuRange, customerName, startDate, endDate, ready } = filters;
  const [selectedPromoTypes, setSelectedPromoTypes] = useState(ALL_PROMO_TYPE_VALUES);
  const [selectedPackTypes, setSelectedPackTypes] = useState(ALL_PACK_TYPE_VALUES);
  const [visibleSeries, setVisibleSeries] = useState({
    ...ALL_SERIES_VISIBLE,
    [SIMULATED_SERIES.key]: true,
  });
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // Locked budget versions drawn beside the draft to compare ({ version, name }, in the order picked).
  const [comparedVersions, setComparedVersions] = useState([]);
  const compared = useBudgetVersions({ year: budgetYear, versions: budget ? comparedVersions.map((item) => item.version) : [] });
  const [compositionSpotlight, setCompositionSpotlight] = useState(null);
  // The panel's tab, here so opening a block from the Monthly plan shows it.
  const [panelTab, setPanelTab] = useState('breakdown');
  const view = useForecastView({ ready,
    productName: budget ? '' : productName, skuRange: budget ? '' : skuRange, customerName: budget ? '' : customerName,
    startDate: budget ? `${budgetYear}-01-01` : startDate, endDate: budget ? `${budgetYear}-12-01` : endDate, tier: DEFAULT_TIER });
  const fullInitial = budget ? initialBudgetRows(view.data.rows) : [];
  const rows = budget ? fullInitial.filter((row) => (!customerName || row.customer_name === customerName)
    && (!skuRange || row.sku_range === skuRange) && (!productName || row.product_name === productName)
    && row.month_year >= startDate && row.month_year <= endDate) : view.data.rows;
  const actuals = budget ? [] : view.data.actuals;
  const months = forecastMonths(rows);
  const promotions = budget ? [] : view.data.promotions;
  const { freshness } = view.data;
  // The Actual line in the picked customer's colour, as on /forecast.
  const { customers: allCustomers } = useAllCustomers();
  const actualColor = customerName ? customerColor(customerName, customerPalette(allCustomers)) : NO_CUSTOMER_COLOR;
  const initialBasis = new Map([...new Set(fullInitial.map((row) => row.customer_name))].map((name) =>
    [name, { startMonth: `${budgetYear}-01-01`, endMonth: `${budgetYear}-12-01`, rows: fullInitial.filter((row) => row.customer_name === name) }]));
  // Budget planning works on one year's entries.
  const scenarioBlocks = useScenarioBlocks({ plan, year: budget ? budgetYear : null });
  // Planned promotions: saved like blocks (hooks/useScenarioPromotions.js).
  const scenarioPromotions = useScenarioPromotions({ plan, year: budget ? budgetYear : null });
  // The uplifts Promotion Uplift Settings has worked out now: promotions take
  // these per product and month (scenarioLiveUplifts.js), else their saved values.
  const calculated = usePromoUpliftCalc();
  const liveIndex = !budget && calculated.data ? liveUpliftIndex(calculated.data.rows) : null;
  const promotionEditor = useScenarioPromotionEditor({ items: scenarioPromotions.promotions,
    onChange: scenarioPromotions.setPromotions, onSave: scenarioPromotions.savePromotion, onDelete: scenarioPromotions.deletePromotion,
    customerOptions: filters.customerOptions, defaultCustomer: customerName, defaultSkuRange: skuRange, months, liveIndex });
  const anchors = usePromoAnchors();
  // Tier 0 split into its baseline and the promotions it carries; official
  // and scenario promotions are worked out on it (scenarioTier0Split.js).
  const tier0Breakdown = useTier0Breakdown({ ready, customerName: budget ? '' : customerName,
    skuRange: budget ? '' : skuRange, basis: budget ? 'initial' : 'current', year: budget ? budgetYear : null });
  // The block open in the panel's editor (a draft, or a saved block opened
  // from the table with Edit); its months are banded on the chart.
  const [selectedId, setSelectedId] = useState(null);
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
    skuRange,
    customerName,
    startDate,
    endDate,
    bounds: filters.bounds,
    rows,
    actuals,
    tier: DEFAULT_TIER,
    mapRows: budget ? initialBudgetRows : (value) => value,
  });
  // Units blocks the filters only partly show (an All SKUs block while one
  // SKU is picked) are split over rows fetched for their whole scope.
  const splitBasis = useUnitsSplitBasis({
    ready: ready && !budget,
    needs: splitBasisNeeds(activeScenarioBlocks(scenarioBlocks.blocks), chartView(filters), rows),
  });

  if (!ready) {
    return filters.error ? (
      <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue">
        {filters.error}
      </p>
    ) : (
      // The whole page's cards, not a spinner: nothing moves when it loads.
      <ScenarioBuilderSkeleton />
    );
  }

  // Volume only (scenarioEngine.js): the chart, tables and impact strip all
  // read units.
  const singleSeries = Boolean(productName && customerName);
  // What the base line is called in the legend and the tables.
  const baseLabel = budget ? 'Initial base' : 'Current forecast';
  const basePoints = buildMonthlyPoints(rows, actuals, 'units', { singleSeries });

  // Only switched-on blocks and promotions count, on the chart and in the tables.
  // Growths are blocks too (kind 'growth'), edited in the Breakdown tab and
  // never listed with the building blocks.
  const allBlocks = scenarioBlocks.blocks.filter((block) => !isGrowthBlock(block));
  const growthBlocks = scenarioBlocks.blocks.filter(isGrowthBlock);
  const activePromotions = activeScenarioPromotions(scenarioPromotions.promotions);
  const budgetSplitError = budget ? tier0Breakdown.error ?? (tier0Breakdown.data ? initialSplitProblem(tier0Breakdown.data, fullInitial) : null) : null;
  const budgetReady = !budget || Boolean(tier0Breakdown.data && !tier0Breakdown.loading && !budgetSplitError);
  const tier0Split = tier0Breakdown.data && !budgetSplitError ? tier0SplitIndex(tier0Breakdown.data) : null;
  // Everything switched on counts; the official promotions whenever the
  // split is in. Growth is the budget's only: Current forecast's Tier 0
  // already follows recent sales, so growth saved in that mode is ignored.
  const counted = {
    official: !budget && tier0Split ? [OFFICIAL_ITEM] : [],
    growth: budget && budgetReady ? activeScenarioBlocks(growthBlocks) : [],
    blocks: budgetReady ? activeScenarioBlocks(allBlocks) : [],
    promotions: budgetReady ? withLiveIndex(activePromotions, liveIndex) : [],
  };
  const itemInfo = new Map([
    [OFFICIAL_ITEM.id, { name: OFFICIAL_ITEM.name, kind: 'official', state: 'saved' }],
    ...counted.growth.map((block) => [block.id, { name: block.name, kind: 'growth', state: itemState(block, false) }]),
    ...counted.blocks.map((block) => [block.id, { name: block.name, kind: 'block', state: itemState(block, false) }]),
    ...activePromotions.map((promotion) => [
      promotion.id,
      { name: promotion.mechanicLabel, kind: 'promotion', state: itemState(promotion, true) },
    ]),
  ]);
  const activeItems = [...counted.growth, ...counted.blocks, ...activePromotions];
  const { cells, byMonth, byItem } = simulate(
    rows,
    counted,
    SCENARIO_SOURCES,
    chartView(filters, budget ? initialBasis : splitBasis.basis, tier0Split)
  );
  // Nothing simulated until a switched-on item changes something in view:
  // no Simulated line, legend entry or table columns before that.
  const hasSimulated = byItem.size > 0;
  const monthCells = cellsByMonth(cells);
  // Anchors are per customer x SKU range, so only one picked pair has one.
  const rangePicked = Boolean(customerName && skuRange);
  // Promotions have no name of their own; their mechanic stands in.
  const names = new Map([
    [OFFICIAL_ITEM.id, OFFICIAL_ITEM.name],
    ...scenarioBlocks.blocks.map((block) => [block.id, block.name]),
    ...scenarioPromotions.promotions.map((promotion) => [promotion.id, promotion.mechanicLabel]),
  ]);
  const monthItems = new Map(
    [...monthCells].map(([month, items]) => [
      month,
      [...items].map(([itemId, totals]) => ({
        itemId,
        name: names.get(itemId) ?? '',
        state: itemInfo.get(itemId)?.state ?? 'saved',
        ...totals,
      })),
    ])
  );
  // What each month is made of, for the shaded layers, their labels and the
  // hover card (scenarioComposition.js): built on the Simulated line, so the
  // layers always meet it, with Tier 0 split where the split is in.
  // Each month's Tier 0 split, worked out once for the chart and the Monthly plan.
  const monthSplits = new Map(
    tier0Split ? basePoints.map((point) => [point.month_year, monthSplit(rows, tier0Split, point.month_year)]) : []
  );
  // Blocks in months with actuals are milestones: worked back from the
  // actual (scenarioMilestones.js), marked on the Actual line, never moving one.
  const pastMonths = basePoints.filter((point) => point.actual != null && point.current == null).map((point) => point.month_year);
  const rangeOf = Object.fromEntries(rows.map((row) => [row.product_name, row.sku_range ?? null]));
  const milestones = milestoneBreakdown(actuals, activeScenarioBlocks(allBlocks), rangeOf);
  const composedPoints = (hasSimulated ? withSimulatedLine(basePoints, byMonth) : basePoints).map((point) => {
    const composed = withComposition(point, [...(monthCells.get(point.month_year)?.values() ?? [])], monthSplits.get(point.month_year) ?? null);
    const milestone = milestones.get(point.month_year);
    return milestone ? { ...composed, milestones: milestone } : composed;
  });
  // Compared locked versions, each totalled in the chart's scope under its own
  // key; one shows until its legend pill is switched off.
  const versionSeries = budgetVersionSeries(comparedVersions);
  const shownSeries = { ...Object.fromEntries(versionSeries.map((series) => [series.key, true])), ...visibleSeries };
  const chartPoints = versionSeries.reduce((points, series, index) => withBudgetPoints(points,
    compared.data[comparedVersions[index].version] ?? [], { productName, customerName, skuRange, startDate, endDate },
    undefined, budgetVersionKey(comparedVersions[index].version)), composedPoints);
  // Each month's parts, for the Monthly plan, and the months the promotions
  // planned move by more than 35% of Tier 0 (Big change).
  const breakdowns = new Map(chartPoints.filter((point) => point.breakdown).map((point) => [point.month_year, point.breakdown]));
  function monthChange(month) {
    const breakdown = breakdowns.get(month);
    return breakdown ? bigChange(breakdown.tier0, breakdown.official + breakdown.promotions) : null;
  }
  const tier0SplitState = { index: tier0Split, loading: tier0Breakdown.loading, error: budgetSplitError ?? tier0Breakdown.error,
    basis: budget ? 'initial' : 'current', dataCutoff: tier0Breakdown.data?.data_cutoff ?? null };
  // The anchor in the hover card: one customer x SKU range has one.
  const anchorTarget = !budget && rangePicked
    ? anchorTargets(anchors.data).find((target) => target.customerName === customerName && target.skuRange === skuRange)
    : null;
  function anchorForMonth(month) {
    if (!anchorTarget) return null;
    const anchor = anchorInMonth(anchorTarget.entry, month);
    return `${anchorLabel(anchor)} · ${anchorSourceLabel(anchor.source)}`;
  }
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
  // Saved, switched-on blocks that aren't open in the panel, split by
  // whether they apply to the chart as filtered (customer, SKU, months): the
  // panel shows those as cards when no block is being edited, and only counts
  // the rest, so it never lists a block for another customer, SKU or period.
  const viewRange = chartView(filters);
  const savedSwitchedOn = savedBlocks.filter((block) => block.isActive && !panelBlocks.includes(block));
  const savedOnChart = savedSwitchedOn.filter((block) =>
    itemInView(block, filters, viewRange.startMonth || '0000-01-01', viewRange.endMonth || '9999-12-01')
  );
  // Switched-on blocks for the chart's customer and SKU whose months all
  // have actual sales by now: they change nothing, and say so rather than
  // reading as "outside chart filters".
  const fetchedMonths = [...new Set(rows.map((row) => row.month_year))];
  const openMonths = new Set(forecastMonths(rows));
  const closedIds = new Set(
    allBlocks
      .filter((block) => {
        if (!itemInView(block, filters, '0000-01-01', '9999-12-01')) return false;
        const covered = fetchedMonths.filter((month) => month >= block.startMonth && month <= block.endMonth);
        return covered.length > 0 && covered.every((month) => !openMonths.has(month));
      })
      .map((block) => block.id)
  );

  const simulatedYears = simulatedYearTotals(years, byMonth);
  const scenario = {
    baseLabel: budget ? 'Initial forecast' : 'Tier 0',
    // The chart takes the Simulated colour from series[0].
    series: hasSimulated ? [SIMULATED_SERIES] : [],
    markers: hasSimulated ? itemMarkers(byItem) : [],
    milestoneMonths: [...milestones.keys()],
    promoBands: draftPromotionBands(activePromotions),
    seasonalAverage: seasonalAverage(basePoints),
    monthItems,
    anchorForMonth,
    selectedBand:
      selectedBlock && byItem.has(selectedBlock.id)
        ? { startMonth: selectedBlock.startMonth, endMonth: selectedBlock.endMonth, label: selectedBlock.name }
        : null,
  };

  // Comparison table rows: each year in view, then the next 12 months (the
  // months the Current line covers).
  const horizonMonths = basePoints.filter((point) => point.current != null).map((point) => point.month_year);
  const comparisonRows = [
    ...simulatedYears.map((year) => {
      const base = years.find((item) => item.year === year.year);
      const yearMonths = [...monthCells.keys()].filter((month) => month.slice(0, 4) === year.year);
      return {
        key: year.year,
        label: year.year,
        caption: base ? mixCaption(base) : '',
        current: base?.volume.total ?? null,
        delta: year.deltaUnits,
        parts: partsInMonths(monthCells, yearMonths),
        ...itemsInMonths(monthCells, yearMonths, itemInfo, {
          activeItems,
          filters,
          first: `${year.year}-01-01`,
          last: `${year.year}-12-01`,
        }),
      };
    }),
    ...(horizonMonths.length
      ? [
          {
            key: 'next-12',
            label: 'Next 12 months',
            current: sumHorizonForecast(basePoints),
            delta: horizonMonths.reduce((total, month) => total + (byMonth.get(month)?.deltaUnits ?? 0), 0),
            parts: partsInMonths(monthCells, horizonMonths),
            ...itemsInMonths(monthCells, horizonMonths, itemInfo, {
              activeItems,
              filters,
              first: horizonMonths[0],
              last: horizonMonths[horizonMonths.length - 1],
            }),
          },
        ]
      : []),
  ];

  const error =
    filters.error ?? view.error ?? scenarioBlocks.error ?? scenarioPromotions.error ?? promotionEditor.error ?? budgetSplitError ?? splitBasis.error ?? actionError;

  const customerText = customerName ? customerLabel(customerName) : 'All customers';

  async function savePanelBlock(block) {
    await scenarioBlocks.saveBlock(block);
    // Saved: it moves to the table, and the panel lets it go.
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

  // A customer x SKU range switched on or off saves straight away, like the
  // block's own switch; on failure the block goes back to how it was.
  async function togglePair(block, customer, skuRange, on) {
    const next = updateScenarioBlock(block, { excludedPairs: withPairSwitched(block, customer, skuRange, on) });
    const label = `${customerLabel(customer)} · ${skuRange ?? 'No SKU range'}`;
    setActionError(null);
    setTogglingIds((current) => [...current, block.id]);
    scenarioBlocks.setBlocks((current) => current.map((item) => (item.id === block.id ? next : item)));
    try {
      await scenarioBlocks.saveBlock(next);
    } catch (err) {
      scenarioBlocks.setBlocks((current) => current.map((item) => (item.id === block.id ? block : item)));
      setActionError(`Couldn't ${on ? 'switch on' : 'switch off'} ${label} in ${block.name}: ${err.message}`);
    } finally {
      setTogglingIds((current) => current.filter((id) => id !== block.id));
    }
  }

  function editSaved(block) {
    setSelectedId(block.id);
    changePanelTab('blocks');
    setPanelCollapsed(false);
  }

  function editSavedPromotion(promotion) {
    promotionEditor.select(promotion.id);
    changePanelTab('promotions');
    setPanelCollapsed(false);
  }

  function changePanelTab(tab) {
    setCompositionSpotlight(null);
    setPanelTab(tab);
  }

  // From the monthly plan: open a block (draft promotions aren't edited
  // here) in the panel.
  function openItem(itemId) {
    const block = allBlocks.find((item) => item.id === itemId);
    if (block) editSaved(block);
  }

  const sectionProps = {
    customerOptions: filters.customerOptions,
    months,
    defaultCustomer: customerName,
    impacts: byItem,
  };

  return (
    <div className="space-y-3">
      {budget ? <BudgetLockControl year={budgetYear} unsaved={scenarioBlocks.unsavedCount + scenarioPromotions.unsavedCount}
        loading={view.loading || scenarioBlocks.loading || scenarioPromotions.loading || tier0Breakdown.loading || promotionEditor.saving || promotionEditor.togglingIds.length > 0} hasInitial={fullInitial.length > 0}
        loadError={view.error ?? scenarioBlocks.error ?? scenarioPromotions.error ?? promotionEditor.error ?? budgetSplitError}
        entryCount={scenarioBlocks.blocks.filter((block) => block.blockId != null).length + scenarioPromotions.promotions.filter((promotion) => promotion.promotionId != null).length}
        compared={comparedVersions} onComparedChange={setComparedVersions} compareError={compared.error}
        onRestarted={onBudgetRestarted} /> : null}
      {error && (
        <p className="rounded-md border border-violet bg-lavander/50 px-3 py-2 text-sm text-deep-violet-blue">
          {error}
        </p>
      )}

      <div
        className={cn(
          'grid items-start gap-3',
          panelCollapsed
            ? 'min-[1100px]:grid-cols-[minmax(0,1fr)_56px]'
            // A capped panel width leaves the chart card room for the Monthly plan's columns.
            : 'min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] min-[1100px]:items-stretch'
        )}
      >
        <div className="min-w-0 space-y-3 min-[1100px]:flex min-[1100px]:flex-col min-[1100px]:[&>[data-slot=card]]:flex-1">
          <ForecastChart
          points={chartPoints}
            baseSeries={budget
              ? FORECAST_SERIES.filter((series) => series.key === 'current').map((series) => ({ ...series, label: baseLabel }))
              : FORECAST_SERIES.map((series) => (series.key === 'current' ? { ...series, label: baseLabel } : series))}
            startDate={startDate}
            endDate={endDate}
            metric="units"
            singleSeries={singleSeries}
            actualColor={actualColor}
            // SKU and customer are in the toolbar's filters; the model isn't.
            scopeTags={[{ label: 'Model', value: MODEL_LABEL }]}
            toolbar={
              <ForecastFilters
                variant="toolbar"
                skuRange={skuRange}
                onSkuRangeChange={filters.setSkuRange}
                skuRangeOptions={filters.skuRangeOptions}
                customerName={customerName}
                onCustomerNameChange={filters.setCustomerName}
                customerOptions={filters.customerOptions}
                startDate={startDate}
                endDate={endDate}
                onStartDateChange={filters.setStartDate}
                onEndDateChange={filters.setEndDate}
                minDate={budget ? `${budgetYear}-01-01` : filters.bounds.start}
                maxDate={budget ? `${budgetYear}-12-31` : filters.bounds.end}
                onClearFilters={filters.clear}
                canClearFilters={filters.canClear}
              />
            }
            yearTable={
              <ScenarioTotals
                singleSeries={singleSeries}
                yearTable={
                  <ScenarioYearComparison
                    rows={comparisonRows}
                    baseLabel={baseLabel}
                    loading={yearTotalsLoading || view.loading}
                  />
                }
                monthlyPlan={
                  <MonthlyPlan
                    allowOfficialPlanning={!budget}
                    baseLabel={baseLabel}
                    ready={ready}
                    productName={productName}
                    skuRange={skuRange}
                    customerName={customerName}
                    startDate={startDate}
                    endDate={endDate}
                    rows={rows}
                    actuals={actuals}
                    byMonth={byMonth}
                    monthItems={monthItems}
                    onOpenItem={openItem}
                    scope={`${customerText} · ${skuRange || 'All SKU ranges'}`}
                    breakdowns={breakdowns}
                    splits={monthSplits}
                    split={Boolean(tier0Split)}
                    flagged={(month) => Boolean(monthChange(month))}
                    detailsFor={(month) => (
                      <Tier0Details
                        month={month}
                        rows={rows}
                        tier0Split={tier0SplitState}
                        anchor={anchorForMonth(month)}
                        change={monthChange(month)}
                      />
                    )}
                  />
                }
              />
            }
            promotions={promotions}
            selectedPromoTypes={selectedPromoTypes}
            onTogglePromoType={(value) => setSelectedPromoTypes((current) => toggleSelectedValue(current, value))}
            selectedPackTypes={selectedPackTypes}
            onTogglePackType={(value) => setSelectedPackTypes((current) => toggleSelectedValue(current, value))}
            extraSeries={versionSeries}
            visibleSeries={shownSeries}
            onToggleSeries={(key) => setVisibleSeries((current) => ({ ...current, [key]: !shownSeries[key] }))}
            lastRun={budget ? freshness.initial_generated_at : freshness.current_generated_at}
            salesLabel={customerName ? `${customerText} sales` : 'All customers sales'}
            salesLoadedAt={freshness.latest_sales_loaded_at}
            loading={view.loading || (budget && tier0Breakdown.loading)}
            scenario={{
              ...scenario,
              // Every layer drawn: a part left out is 0, so it has nothing to show.
              compositionVisible: Object.fromEntries(COMPOSITION_LAYERS.map((layer) => [layer.key, true])),
              compositionSpotlight,
              // Stacked bottom to top: Tier 0's baseline and what it carries,
              // official promotions, what growth, blocks and scenario
              // promotions add, then what takes units away, hatched
              // (FrozenBaselinePanel's COMPOSITION_LAYERS).
              composition: COMPOSITION_LAYERS.map(({ key, color, opacity, hatch }) => ({ key, color, opacity, hatch })),
            }}
          />

        </div>

        {/* Side by side, the panel and the chart card are the same height: the
            row is as tall as the taller of the two and the other stretches.
            Space the editor leaves free holds the cards of what is on the
            chart, so a short panel never shows as a blank column. */}
        <div className={cn('min-w-0', panelCollapsed ? null : 'min-[1100px]:[&>aside]:h-full')}>
        <ScenarioPanel
          plan={plan}
          collapsed={panelCollapsed}
          onCollapsedChange={(collapsed) => { setCompositionSpotlight(null); setPanelCollapsed(collapsed); }}
          tab={panelTab}
          onTabChange={changePanelTab}
          breakdownSection={
            <FrozenBaselinePanel
              onSpotlight={setCompositionSpotlight}
              plan={plan}
              tier0Split={tier0SplitState}
              growthSection={
                !budget ? null : scenarioBlocks.loading ? (
                  <p className="text-xs text-deep-violet-blue/60">Loading growth…</p>
                ) : (
                  <GrowthControl
                    plan={plan}
                    blocks={growthBlocks}
                    customer={customerName}
                    years={growthYears(months)}
                    impacts={byItem}
                    onChange={scenarioBlocks.setBlocks}
                    onSave={scenarioBlocks.saveBlock}
                    onRemove={scenarioBlocks.deleteBlock}
                  />
                )
              }
              totals={breakdownTotals(breakdowns)}
              milestones={milestones}
            />
          }
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
                savedOnChart={savedOnChart}
                savedElsewhereCount={savedSwitchedOn.length - savedOnChart.length}
                onEditSaved={editSaved}
                onToggleSaved={toggleSaved}
                togglingIds={togglingIds}
                closedIds={closedIds}
                skuRangeOptions={filters.skuRangeOptions}
                defaultSkuRange={skuRange}
                pastMonths={pastMonths}
                {...sectionProps}
              />
            )
          }
          promotionsSection={
            scenarioPromotions.loading ? (
              <p className="text-xs text-deep-violet-blue/60">Loading promotions…</p>
            ) : (
              <PromotionsSection
                editor={promotionEditor}
                plan={plan}
                rows={rows}
                pairsFor={(promotion) => itemPairs(rows, promotion, cells)}
                skuRangeOptions={filters.skuRangeOptions}
                defaultSkuRange={skuRange}
                liveIndex={liveIndex}
                liveLoading={calculated.loading}
                liveError={calculated.error}
                {...sectionProps}
              />
            )
          }
        />
        </div>
      </div>

      <BlockTable
        blocks={savedBlocks}
        baseLabel={baseLabel}
        impacts={byItem}
        monthsByItem={monthsByItem}
        isLoading={scenarioBlocks.loading}
        error={scenarioBlocks.error}
        onRefresh={scenarioBlocks.refresh}
        editingId={selectedBlock?.saved ? selectedBlock.id : null}
        togglingIds={togglingIds}
        isExpanded={expandedRows.isExpanded}
        onToggleRow={expandedRows.toggle}
        onToggleActive={toggleSaved}
        pairsFor={(block) => itemPairs(rows, block, cells)}
        onTogglePair={togglePair}
        onEdit={editSaved}
        onDelete={deletion.request}
        closedIds={closedIds}
      />

      <PromotionTable items={scenarioPromotions.promotions} editor={promotionEditor} impacts={byItem}
        monthsByItem={monthsByItem} liveIndex={liveIndex} onEdit={editSavedPromotion} onRefresh={scenarioPromotions.refresh}
        isLoading={scenarioPromotions.loading} error={scenarioPromotions.error} baseLabel={baseLabel}
        previewReady={budgetReady} showNotice={panelTab !== 'promotions'} />

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
                  value: `${customersLabel(deletion.target.customers)} · ${blockScopeLabel(deletion.target)}`,
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
