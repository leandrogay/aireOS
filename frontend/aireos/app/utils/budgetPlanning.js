export const BUDGET_COLORS = { sellIn: '#5A6B21', sellOut: '#A61E4D' };

export const BUDGET_SERIES = {
  key: 'budget', label: 'Budget', color: BUDGET_COLORS.sellOut, dash: '12 3 2 3', shape: 'square', connectNulls: false,
};

/** The Initial Yearly Forecast as a plain simulation base, with no actuals or confidence claims. */
export function initialBudgetRows(rows) {
  return rows.filter((row) => row.forecast_initial != null).map((row) => ({
    ...row, forecast_current: row.forecast_initial, forecast_previous: null,
    actual_status: 'not_yet', current_low_80: null, current_high_80: null,
    current_confidence_band: null, month_confidence_band: null,
  }));
}

/** Refuse a Budget preview when its split and the displayed Initial are from different reads. */
export function initialSplitProblem(data, rows) {
  if (data.basis !== 'initial') return 'The budget needs the Initial breakdown at its own data cut-off.';
  if (data.unavailable?.length) return `Initial breakdown unavailable: ${data.unavailable[0].reason}`;
  const index = new Map((data.rows ?? []).map((row) => [`${row.customer_id}|${row.sku}|${row.month_year}`, row]));
  for (const row of rows) {
    const split = index.get(`${row.customer_id}|${row.sku}|${row.month_year}`);
    if (!split || ![split.tier0, split.baseline, split.carried].every(Number.isFinite)
      || Math.abs(split.tier0 - row.forecast_initial) > 0.000001
      || Math.abs(split.baseline + split.carried - row.forecast_initial) > 0.000001) {
      return 'Initial and its breakdown do not match. Reload before previewing or locking this budget.';
    }
  }
  return null;
}

/**
 * The customers with months Initial's breakdown kept whole (backend
 * initial_breakdown `unsplit`: their sales changed after Initial was fixed),
 * sorted, for the Breakdown tab's note.
 */
export function unsplitCustomers(data) {
  return [...new Set((data?.unsplit ?? []).map((cell) => cell.customer_name).filter(Boolean))].sort();
}

// A locked budget row in the chart's customer, SKU, range and months.
function inBudgetScope(row, scope) {
  if (scope.customerName && scope.customerName !== row.customer_name) return false;
  if (scope.productName && scope.productName !== row.product_name) return false;
  if (scope.skuRange && scope.skuRange !== row.sku_range) return false;
  if (scope.startDate && row.month_year < scope.startDate.slice(0, 7) + '-01') return false;
  if (scope.endDate && row.month_year > scope.endDate) return false;
  return true;
}

/**
 * What a locked version is made of each month in the chart's scope, for the
 * Breakdown tab and the chart's layers when it is the line picked there:
 * Map month_year -> { initial, baseline, carried, growth, blocks,
 * promotionsAdded, promotionsReplaced, units } (backend budgets.read_budgets
 * `parts`, worked out from the version's own inputs). Null when a row in
 * scope has no parts (a version locked before they were saved).
 *
 * @param {object[]} rows one version's rows (GET /api/scenario/budgets?year=&version=)
 * @param {object} scope as withBudgetPoints
 */
export function budgetVersionMonths(rows, scope = {}) {
  const months = new Map();
  for (const row of rows) {
    if (!inBudgetScope(row, scope)) continue;
    const parts = row.parts;
    if (!parts || parts.baseline == null) return null;
    const month = months.get(row.month_year) ?? { initial: 0, baseline: 0, carried: 0, growth: 0, blocks: 0,
      promotionsAdded: 0, promotionsReplaced: 0, units: 0 };
    month.initial += parts.initial;
    month.baseline += parts.baseline;
    month.carried += parts.carried;
    month.growth += parts.growth;
    month.blocks += parts.blocks;
    month.promotionsAdded += parts.promotions_added;
    month.promotionsReplaced += parts.promotions_replaced;
    month.units += row.units;
    months.set(row.month_year, month);
  }
  return months;
}

/**
 * Frozen budget totals in the requested scope, including months the rolling
 * forecast no longer reaches, as `key` on each point (the Budget line's
 * 'budget', or a compared version's key).
 */
export function withBudgetPoints(points, rows, scope = {}, makePoint = (month) => ({ month_year: month }), key = 'budget') {
  const totals = new Map();
  for (const row of rows) {
    if (!inBudgetScope(row, scope)) continue;
    totals.set(row.month_year, (totals.get(row.month_year) ?? 0) + row.units);
  }
  const merged = new Map(points.map((point) => [point.month_year, { ...point, [key]: null }]));
  for (const [month, units] of totals) merged.set(month, { ...(merged.get(month) ?? makePoint(month)), [key]: units });
  return [...merged.values()].sort((a, b) => a.month_year.localeCompare(b.month_year));
}

// At most this many locked versions are compared on the Budget planning
// chart at once. They share the Budget colour and differ by dash and marker,
// so they read as budgets beside the draft's Simulated line.
export const MAX_COMPARED_VERSIONS = 3;
const VERSION_STYLES = [
  { dash: '12 3 2 3', shape: 'square' },
  { dash: '6 4', shape: 'triangle' },
  { dash: '2 3', shape: 'circle' },
];

/** The chart key of a compared locked version. */
export function budgetVersionKey(version) {
  return `budget_v${version}`;
}

/** A version's name as the history and the legend show it: "Version 2 · Base case". */
export function budgetVersionLabel(item) {
  return `Version ${item.version}${item.name ? ` · ${item.name}` : ''}`;
}

/**
 * The chart series of compared versions, in the order picked.
 *
 * @param {{ version: number, name?: string | null }[]} items history entries
 */
export function budgetVersionSeries(items) {
  return items.slice(0, MAX_COMPARED_VERSIONS).map((item, index) => ({
    key: budgetVersionKey(item.version), label: budgetVersionLabel(item), color: BUDGET_COLORS.sellOut,
    connectNulls: false, ...VERSION_STYLES[index],
  }));
}

/**
 * The years Budget planning offers: this year and next, those with an
 * Initial Yearly Forecast (initial-status `forecast_year`s). Next year's
 * appears from about September; with no status (a failed read) both are offered.
 *
 * @param {{ forecast_year: number | string }[]} initialStatus
 * @param {number} thisYear
 */
export function budgetYears(initialStatus, thisYear) {
  const candidates = [thisYear, thisYear + 1];
  const known = new Set((initialStatus ?? []).map((item) => Number(item.forecast_year)));
  const available = candidates.filter((year) => known.has(year));
  return available.length ? available : candidates;
}

// ============================================================
// LOCKED BUDGET AS THE INITIAL YEARLY FORECAST
// A "Show locked yearly budget" switch on the Forecast page and the Inventory sell-in
// chart (on by default): in months a locked budget covers, the Initial Yearly
// Forecast line shows the budget instead of Tier 0's plan, and is relabelled
// so it never passes the budget off as the plan. Off shows the plan.
// ============================================================

export const BUDGET_TOGGLE_LABEL = 'Show locked yearly budget';
export const BUDGET_TOGGLE_ON_HINT =
  "The Initial Yearly Forecast line shows Aire's latest locked budget in the months it covers. Other lines remain unchanged.";
export const BUDGET_TOGGLE_OFF_HINT = 'Turn on to show the budget on the Initial Yearly Forecast line only.';
export const BUDGET_TOGGLE_NONE_HINT = 'No locked budget for these months. Changes only the Initial Yearly Forecast line.';
export const INITIAL_BUDGET_LABEL = 'Initial Yearly Forecast (Budget)';
export const INITIAL_BUDGET_HINT =
  "Initial Yearly Forecast (Budget): Aire's latest locked budget in the months it covers (the yearly plan plus " +
  "the building blocks and promotions added on top in the Scenario builder), and Tier 0's yearly plan in other " +
  'months. Its units stay frozen when the forecast changes. Turn off Show locked yearly budget to see the plan alone.';
// The Inventory chart's two Initial lines, while they show the budget.
export const INITIAL_BUDGET_INVENTORY_LABELS = {
  sell_in_initial: 'Initial Yearly Sell-in Forecast (Budget)',
  sell_out_initial: 'Initial Yearly Sell-out Forecast (Budget)',
};

/** Whether any Forecast page month in view has a locked budget (withBudgetPoints' `budget`). */
export function hasBudgetPoints(points) {
  return (points ?? []).some((point) => point.budget != null);
}

/**
 * Forecast page months with the locked budget as the Initial value where it
 * has one. The budget has no 80% range and isn't the plan the Initial vs
 * actual note measures, so in those months both are cleared; other months
 * keep the plan untouched. `initialFromBudget` marks the swapped months.
 *
 * @param {object[]} points buildMonthlyPoints + withBudgetPoints
 */
export function budgetAsInitial(points) {
  return (points ?? []).map((point) => {
    if (point.budget == null) return point;
    return {
      ...point,
      initial: point.budget,
      initialFromBudget: true,
      // Never equal to the reported count, so no "Initial x% over actual".
      initialSeries: 0,
      initialBand: null,
      confidence: (point.confidence ?? []).map((entry) => ({ ...entry, initial: null })),
    };
  });
}

/** Whether any Inventory sell-in chart month has a locked budget (backend sell_in_budget / sell_out_budget). */
export function hasBudgetMonths(months) {
  return (months ?? []).some((row) => row.sell_in_budget != null || row.sell_out_budget != null);
}

/**
 * Inventory sell-in chart months with the locked budget as the two Initial
 * lines where it has values: sell-out budget for Initial sell-out, and the
 * sell-in plan worked out from it for Initial sell-in (backend
 * get_sell_in_outlook). Other months keep the plan's values.
 *
 * @param {object[]} months get_sell_in_outlook months
 */
export function budgetAsInitialMonths(months) {
  return (months ?? []).map((row) => ({
    ...row,
    sell_in_initial: row.sell_in_budget ?? row.sell_in_initial,
    sell_out_initial: row.sell_out_budget ?? row.sell_out_initial,
  }));
}

/**
 * What a year's Budget scenario builds on, in words, from its recorded start
 * (GET /api/scenario/budgets?year= `draft`; null = not started):
 * "version 2 · Test A", or "the Initial Yearly Forecast alone" for scratch.
 *
 * @param {{ started_from_version: number | null } | null} draft
 * @param {{ version: number, name: string | null }[]} history
 */
export function draftBaseLabel(draft, history = []) {
  if (!draft) return null;
  if (draft.started_from_version == null) return 'the Initial Yearly Forecast alone';
  const version = history.find((item) => item.version === draft.started_from_version);
  return version ? budgetVersionLabel(version) : `Version ${draft.started_from_version}`;
}

/**
 * Where a saved budget entry came from: 'copied' (made by "Start from…" with
 * the draft: same transaction, so the same timestamp), 'edited' (copied, then
 * changed or switched), 'added' (saved after the start), or null when the
 * draft or the entry's times are unknown.
 *
 * @param {{ createdAt?: string | null, updatedAt?: string | null }} item
 * @param {{ started_from_version: number | null, started_at: string } | null} draft
 */
export function draftEntryOrigin(item, draft) {
  if (!draft || !item.createdAt) return null;
  const started = Date.parse(draft.started_at);
  const created = Date.parse(item.createdAt);
  if (draft.started_from_version != null && created === started) {
    return Date.parse(item.updatedAt ?? item.createdAt) > started ? 'edited' : 'copied';
  }
  return 'added';
}

/**
 * Whether a year's Budget scenario has been started, so adding to it goes
 * straight through instead of asking "Start from…". Started when its start
 * is recorded (budget_drafts, migration 033), or when it already has saved
 * entries: those were made before starts were recorded, and asking would
 * offer only to replace them. Before 033, an empty draft with locked
 * versions to build on asks.
 *
 * @param {{ draft: object | null, draftsEnabled?: boolean, savedEntries: number, versionCount: number }} state
 */
export function isDraftStarted({ draft, draftsEnabled, savedEntries, versionCount }) {
  if (draft || savedEntries > 0) return true;
  return draftsEnabled ? false : versionCount === 0;
}

/**
 * Why a budget entry can't be added yet, or null: the year's start is still
 * being read, or couldn't be (useBudgets), so the page never guesses.
 *
 * @param {{ loading: boolean, error: string | null }} budgets
 */
export function addBlockedReason({ loading, error }) {
  if (error) return `Can't check what this budget builds on: ${error}`;
  return loading ? 'Checking what this budget builds on…' : null;
}

/**
 * Why "Start from…" must wait, or null: starting replaces the year's saved
 * entries, so an unsaved edit to one would be left pointing at nothing.
 *
 * @param {number} editedSaved saved entries with unsaved edits
 */
export function startBlockedReason(editedSaved) {
  if (!editedSaved) return null;
  return `Save or discard the ${editedSaved} edited saved ${editedSaved === 1 ? 'entry' : 'entries'} first: starting replaces them.`;
}

/**
 * A saved entry's origin under its name in the saved tables: "From Version 2
 * · Test A", "… · edited", or "Added" (draftEntryOrigin), the draft named as
 * everywhere else (draftBaseLabel); null when unknown.
 *
 * @param {object} item
 * @param {object | null} draft
 * @param {{ version: number, name: string | null }[]} history
 */
export function draftOriginLabel(item, draft, history = []) {
  const origin = draftEntryOrigin(item, draft);
  if (!origin) return null;
  if (origin === 'added') return 'Added';
  const from = `From ${draftBaseLabel(draft, history)}`;
  return origin === 'edited' ? `${from} · edited` : from;
}

/**
 * True when "Start from…" copied in a growth for this growth's customer
 * (POST /budgets/start `growth_customers`): one growth per customer x year,
 * so the one being typed is not saved as well.
 *
 * @param {{ customers?: string[] }} growth
 * @param {{ growth_customers?: string[] } | null} started
 */
export function growthCameWithStart(growth, started) {
  const copied = started?.growth_customers ?? [];
  return (growth.customers ?? []).some((customer) => copied.includes(customer));
}
