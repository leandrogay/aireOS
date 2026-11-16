import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_COMPARED_VERSIONS, budgetAsInitial, budgetVersionMonths, addBlockedReason, draftBaseLabel, draftEntryOrigin, draftOriginLabel, growthCameWithStart, isDraftStarted, startBlockedReason, budgetAsInitialMonths, budgetYears, budgetVersionKey, budgetVersionSeries, hasBudgetMonths, hasBudgetPoints, initialBudgetRows, initialSplitProblem, unsplitCustomers, withBudgetPoints } from '../app/utils/budgetPlanning.js';
import { promotionCells, tier0SplitIndex } from '../app/utils/scenarioTier0Split.js';

test('budget simulation uses Initial and excludes series without it, without changing the original forecast', () => {
  const rows = [{ forecast_initial: 100, forecast_current: 999, forecast_previous: 80, actual_status: 'reported' }, { forecast_initial: null, forecast_current: 999 }];
  assert.deepEqual(initialBudgetRows(rows).map((row) => row.forecast_current), [100]);
  assert.equal(initialBudgetRows(rows)[0].actual_status, 'not_yet');
  assert.equal(rows[0].forecast_current, 999);
});

test('Budget follows customer, product, range and date filters and preserves zeros and gaps', () => {
  const row = { month_year: '2027-01-01', customer_name: 'A', product_name: 'P', sku_range: 'Pants', units: 0 };
  const rows = [row, { ...row, month_year: '2027-02-01', units: 50 }, { ...row, customer_name: 'B', units: 1000 }];
  const points = [{ month_year: '2027-01-01', current: 100 }, { month_year: '2027-03-01', current: 200 }];
  const result = withBudgetPoints(points, rows, { customerName: 'A', productName: 'P', skuRange: 'Pants', startDate: '2027-01-01', endDate: '2027-12-01' });
  assert.deepEqual(result.map((point) => point.budget), [0, 50, null]);
  assert.equal(result[0].current, 100);
  assert.equal(points[0].budget, undefined);
  assert.deepEqual(withBudgetPoints([], rows, { customerName: 'A', endDate: '2027-01-31' }).map((point) => point.budget), [0]);
  assert.equal(withBudgetPoints([], rows, { skuRange: 'Tape' }).length, 0);
});

const initialRow = { customer_id: 1, customer_name: 'FairPrice', sku: 'A', product_name: 'Pants M',
  month_year: '2027-01-01', forecast_initial: 110, forecast_current: 999 };
const initialSplit = { customer_id: 1, sku: 'A', month_year: '2027-01-01', tier0: 110, baseline: 100, carried: 10,
  official: { planned: false } };

test('a Budget promotion replaces Initial carried effects using Initial rather than Current units', () => {
  const rows = initialBudgetRows([initialRow]);
  const cells = promotionCells([{ id: 'promotion' }], tier0SplitIndex({ rows: [initialSplit] }),
    () => rows, () => 20, () => 1);
  assert.equal(cells[0].baseUnits, 110);
  assert.equal(cells[0].addedUnits, 20);
  assert.equal(cells[0].replacedUnits, 10);
  assert.equal(rows[0].forecast_current + cells[0].deltaUnits, 120);
});

test('preview reconciliation rejects a Current split or a different Initial snapshot', () => {
  const data = { basis: 'initial', rows: [initialSplit], unavailable: [] };
  assert.equal(initialSplitProblem(data, [initialRow]), null);
  assert.match(initialSplitProblem({ ...data, basis: 'current' }, [initialRow]), /own data cut-off/);
  assert.match(initialSplitProblem(data, [{ ...initialRow, forecast_initial: 111 }]), /do not match/);
  assert.match(initialSplitProblem({ ...data, rows: [] }, [initialRow]), /do not match/);
  assert.match(initialSplitProblem({ ...data, rows: [{ ...initialSplit, baseline: NaN }] }, [initialRow]), /do not match/);
});

test('missing source history reports the server explanation and blocks Budget preview', () => {
  const error = initialSplitProblem({ basis: 'initial', rows: [], unavailable: [{ reason: 'No recorded data cut-off' }] }, [initialRow]);
  assert.match(error, /No recorded data cut-off/);
});

test('a compared version is totalled under its own key, leaving the Budget line alone', () => {
  const rows = [{ month_year: '2027-01-01', units: 4, customer_name: 'FairPrice' }, { month_year: '2027-01-01', units: 6, customer_name: 'Sheng' }];
  const points = withBudgetPoints([{ month_year: '2027-01-01', budget: 99 }], rows, { customerName: 'FairPrice' }, undefined, budgetVersionKey(2));
  assert.deepEqual(points, [{ month_year: '2027-01-01', budget: 99, budget_v2: 4 }]);
});

test('compared versions are labelled by number and name, at most three, each with its own dash', () => {
  const series = budgetVersionSeries([{ version: 1, name: 'Base case' }, { version: 3, name: null }, { version: 4 }, { version: 5 }]);
  assert.deepEqual(series.map((item) => item.label), ['Version 1 · Base case', 'Version 3', 'Version 4']);
  assert.equal(new Set(series.map((item) => item.dash)).size, MAX_COMPARED_VERSIONS);
  assert.equal(series[1].key, 'budget_v3');
});

test('budget years are this year and next, once each has an Initial Yearly Forecast', () => {
  assert.deepEqual(budgetYears([{ forecast_year: 2026 }], 2026), [2026]);
  assert.deepEqual(budgetYears([{ forecast_year: '2026' }, { forecast_year: 2027 }, { forecast_year: 2025 }], 2026), [2026, 2027]);
  assert.deepEqual(budgetYears([], 2026), [2026, 2027]);
});

// ---- Locked budget as the Initial Yearly Forecast ----

test('the locked budget replaces Initial only in the months it covers, without its range or the plan comparison', () => {
  const planMonth = { month_year: '2027-01-01', initial: 100, initialSeries: 2, initialBand: 'high', budget: null,
    confidence: [{ key: 'a', initial: { low: 80, high: 120 } }] };
  const budgetMonth = { ...planMonth, month_year: '2027-02-01', budget: 130 };
  const [plan, budget] = budgetAsInitial([planMonth, budgetMonth]);
  assert.equal(plan, planMonth);
  assert.equal(budget.initial, 130);
  assert.equal(budget.initialFromBudget, true);
  assert.equal(budget.initialSeries, 0);
  assert.equal(budget.initialBand, null);
  assert.equal(budget.confidence[0].initial, null);
  assert.equal(budgetMonth.initial, 100);
});

test('a budget of 0 still replaces the plan', () => {
  assert.equal(budgetAsInitial([{ month_year: '2027-01-01', initial: 100, budget: 0 }])[0].initial, 0);
});

test('the switch is only available while a budget covers a month in view', () => {
  assert.equal(hasBudgetPoints([{ budget: null }, { budget: 0 }]), true);
  assert.equal(hasBudgetPoints([{ budget: null }]), false);
  assert.equal(hasBudgetPoints([]), false);
  assert.equal(hasBudgetMonths([{ sell_in_budget: null, sell_out_budget: 5 }]), true);
  assert.equal(hasBudgetMonths([{ sell_in_budget: null, sell_out_budget: null }]), false);
});

test('Inventory Initial lines take the budget where it has values and keep the plan elsewhere', () => {
  const months = [
    { month: '2027-01-01', sell_in_initial: 10, sell_out_initial: 20, sell_in_budget: 15, sell_out_budget: 25 },
    { month: '2027-02-01', sell_in_initial: 11, sell_out_initial: 21, sell_in_budget: null, sell_out_budget: null },
  ];
  assert.deepEqual(budgetAsInitialMonths(months).map((row) => [row.sell_in_initial, row.sell_out_initial]), [[15, 25], [11, 21]]);
  assert.equal(months[0].sell_in_initial, 10);
});

test('a month Initial keeps whole passes the preview check and its promotion adds on top', () => {
  const unsplit = { ...initialSplit, baseline: 110, carried: 0, unsplit: true };
  const data = { basis: 'initial', rows: [unsplit], unavailable: [], unsplit: [{ customer_name: 'FairPrice' }] };
  assert.equal(initialSplitProblem(data, [initialRow]), null);
  const rows = initialBudgetRows([initialRow]);
  const [cell] = promotionCells([{ id: 'promotion' }], tier0SplitIndex(data), () => rows, () => 20, () => 1);
  assert.equal(cell.addedUnits, 22);
  assert.equal(cell.replacedUnits, 0);
});

test('the customers with unsplit months are named once, in order', () => {
  const data = { unsplit: [{ customer_name: 'Pharmex' }, { customer_name: 'NHG' }, { customer_name: 'Pharmex' }] };
  assert.deepEqual(unsplitCustomers(data), ['NHG', 'Pharmex']);
  assert.deepEqual(unsplitCustomers(null), []);
});

test('a compared version is broken down by month in the chart scope, or not at all without its parts', () => {
  const parts = { initial: 100, baseline: 90, carried: 10, growth: 10, blocks: 5, promotions: -3, promotions_added: 7, promotions_replaced: 10 };
  const rows = [
    { month_year: '2027-01-01', customer_name: 'FairPrice', units: 112, parts },
    { month_year: '2027-02-01', customer_name: 'FairPrice', units: 112, parts },
    { month_year: '2027-01-01', customer_name: 'NHG', units: 50, parts: { ...parts, initial: 50 } },
  ];
  const months = budgetVersionMonths(rows, { customerName: 'FairPrice', endDate: '2027-01-01' });
  assert.deepEqual([...months.keys()], ['2027-01-01']);
  assert.deepEqual(months.get('2027-01-01'), { initial: 100, baseline: 90, carried: 10, growth: 10, blocks: 5,
    promotionsAdded: 7, promotionsReplaced: 10, units: 112 });
  assert.equal(budgetVersionMonths([{ ...rows[0], parts: { initial: 100, growth: 0, blocks: 0, promotions: 0 } }]), null);
});

test('the draft says what it builds on, by version name or as scratch', () => {
  const history = [{ version: 2, name: 'Test A' }];
  assert.equal(draftBaseLabel({ started_from_version: 2 }, history), 'Version 2 · Test A');
  assert.equal(draftBaseLabel({ started_from_version: 5 }, history), 'Version 5');
  assert.equal(draftBaseLabel({ started_from_version: null }, history), 'the Initial Yearly Forecast alone');
  assert.equal(draftBaseLabel(null, history), null);
});

test('an entry is copied with the start, edited after it, or added later', () => {
  const draft = { started_from_version: 2, started_at: '2026-11-16T02:00:00.123456+00:00' };
  const at = '2026-11-16T02:00:00.123456+00:00';
  assert.equal(draftEntryOrigin({ createdAt: at, updatedAt: at }, draft), 'copied');
  assert.equal(draftEntryOrigin({ createdAt: at, updatedAt: '2026-11-16T03:00:00+00:00' }, draft), 'edited');
  assert.equal(draftEntryOrigin({ createdAt: '2026-11-16T04:00:00+00:00' }, draft), 'added');
  assert.equal(draftEntryOrigin({ createdAt: at }, { ...draft, started_from_version: null }), 'added');
  assert.equal(draftEntryOrigin({ createdAt: at }, null), null);
  assert.equal(draftEntryOrigin({}, draft), null);
});

test('a draft with saved entries counts as started, so they are never offered for replacement', () => {
  assert.equal(isDraftStarted({ draft: null, draftsEnabled: true, savedEntries: 3, versionCount: 2 }), true);
  assert.equal(isDraftStarted({ draft: null, draftsEnabled: true, savedEntries: 0, versionCount: 2 }), false);
  assert.equal(isDraftStarted({ draft: null, draftsEnabled: true, savedEntries: 0, versionCount: 0 }), false);
  assert.equal(isDraftStarted({ draft: { started_from_version: null }, draftsEnabled: true, savedEntries: 0, versionCount: 0 }), true);
  assert.equal(isDraftStarted({ draft: null, draftsEnabled: false, savedEntries: 0, versionCount: 0 }), true);
  assert.equal(isDraftStarted({ draft: null, draftsEnabled: false, savedEntries: 0, versionCount: 1 }), false);
});

test('adding waits for the start to be read and starting waits for edits to be saved', () => {
  assert.equal(addBlockedReason({ loading: false, error: null }), null);
  assert.match(addBlockedReason({ loading: true, error: null }), /Checking/);
  assert.match(addBlockedReason({ loading: false, error: 'down' }), /down/);
  assert.equal(startBlockedReason(0), null);
  assert.match(startBlockedReason(2), /2 edited saved entries/);
});

test('a row is labelled with the same name as the draft everywhere else', () => {
  const draft = { started_from_version: 2, started_at: '2026-11-16T02:00:00+00:00' };
  const history = [{ version: 2, name: 'Test A' }];
  assert.equal(draftOriginLabel({ createdAt: draft.started_at }, draft, history), 'From Version 2 · Test A');
  assert.equal(draftOriginLabel({ createdAt: draft.started_at, updatedAt: '2026-11-17T00:00:00+00:00' }, draft, history), 'From Version 2 · Test A · edited');
  assert.equal(draftOriginLabel({ createdAt: '2026-11-17T00:00:00+00:00' }, draft, history), 'Added');
  assert.equal(draftOriginLabel({ createdAt: draft.started_at }, null, history), null);
});

test('a growth whose customer came with the copied version is not saved again', () => {
  assert.equal(growthCameWithStart({ customers: ['FairPrice'] }, { growth_customers: ['FairPrice'] }), true);
  assert.equal(growthCameWithStart({ customers: ['NHG'] }, { growth_customers: ['FairPrice'] }), false);
  assert.equal(growthCameWithStart({ customers: ['NHG'] }, null), false);
});
