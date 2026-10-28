// ============================================================
// DEMO ONLY -- an in-memory stand-in for /api/settings/promo-uplifts
// ============================================================
//
// For showing Promotion Uplift Settings and the Scenario builder's
// Promotions tab before the database tables exist (migration
// 006_create_promo_uplift_settings.sql). Every function has the same name,
// arguments and response shape as its real wrapper in
// app/services/settingsApi.js, and follows the same rules as the backend
// (app/services/settings/promo_uplifts.py): versions are never deleted, a
// typed uplift becomes an 'estimate', reset goes back to the rule-based uplift.
//
// NOTHING IS SAVED: the state lives in this browser tab and resets on reload.
// The "suggested" discounts below are made up for the demo; the real ones
// are calculated from each customer's promotions.
//
// To go live: set PROMO_UPLIFTS_DEMO to false in
// app/services/promoUpliftsApi.js and delete this file (after migrations 006
// and 008 have run; docs/promo-uplift-runbook.md). The measurement functions
// at the end return a fixed, made-up result for Fairprice.

import {
  DEFAULT_UPLIFT_PER_POINT_PCT,
  RULE_WARNING,
  RULE_WARNING_ABOVE_PCT,
  ruleBasedUplift,
  ruleBasedUpliftCapped,
} from '@/app/utils/promoUpliftSettings';

const CHANGED_BY = 'aireos';

const SEED_MECHANICS = [
  ['pct_off_5', '5% Off', 5, -6],
  ['pct_off_10', '10% Off', 10, -4],
  ['pct_off_15', '15% Off', 15, -2],
  ['pct_off_20', '20% Off', 20, 0],
  ['pct_off_25', '25% Off', 25, 2],
  ['b2_pct_off_25', 'Buy 2 Get 25% Off', 25, 2],
  ['pct_off_27', '27% Off', 27, 3],
  ['pct_off_30', '30% Off', 30, 4],
  ['b2_pct_off_30', 'Buy 2 Get 30% Off', 30, 4],
  ['b2g1', 'Buy 2 Get 1 Free', 33.3, 5],
  ['pct_off_50', '50% Off', 50, 12],
  ['b1g1', 'Buy 1 Get 1 Free', 50, 12],
  ['voucher', 'Voucher', null, 3],
];

// Made-up earlier versions so History has something to show, oldest first.
// Each one replaces the mechanic's all-customers row at `changed_at`.
const DEMO_HISTORY = [
  ['pct_off_20', { uplift_pct: 1, source: 'estimate', note: 'Feb promo looked slightly better than flat', changed_at: '2026-03-02T02:15:00Z' }],
  ['pct_off_20', { uplift_pct: 0, source: 'rule_based', note: null, changed_at: '2026-06-15T06:40:00Z' }],
  ['pct_off_30', { uplift_pct: 5, source: 'estimate', note: 'Raised after the 11.11 campaign', changed_at: '2026-01-12T03:05:00Z' }],
  ['pct_off_30', { uplift_pct: 6, source: 'estimate', note: 'Raised again after CNY', changed_at: '2026-03-20T08:30:00Z' }],
  ['b1g1', { uplift_pct: 15, source: 'estimate', note: 'B1G1 months sold close to double', changed_at: '2026-05-08T01:50:00Z' }],
  ['pct_off_27', { archived_at: '2026-09-15T05:20:00Z', changed_at: '2026-09-15T05:20:00Z' }],
];

// Made-up earlier ordinary-month discounts, oldest first. anchor_pct null
// with 'suggested' is "Use suggested value" (back to the one from data).
const DEMO_ANCHOR_HISTORY = [
  ['fairprice', { anchor_pct: 22, source: 'manual', changed_at: '2026-02-10T03:00:00Z' }],
  ['fairprice', { anchor_pct: null, source: 'suggested', changed_at: '2026-05-04T06:30:00Z' }],
  ['nhg', { anchor_pct: 18, source: 'manual', changed_at: '2026-09-01T02:45:00Z' }],
];

// Made-up customer, range and SKU values, so the Customer and SKU filters
// narrow the table. Ranges and SKU codes match the real catalogue.
const DEMO_OVERRIDES = [
  { mechanic_key: 'pct_off_25', customer_name: 'fairprice', scope: 'customer', uplift_pct: 3, note: 'FairPrice shoppers respond more to 25% Off', changed_at: '2026-04-03T04:10:00Z' },
  { mechanic_key: 'b1g1', customer_name: 'fairprice', scope: 'sku', sku: '13255045', uplift_pct: 18, note: 'Adult Pants L sells out on B1G1', changed_at: '2026-07-21T07:25:00Z' },
  { mechanic_key: 'b2g1', customer_name: 'nhg', scope: 'range', sku_range: 'Aire Adult Diaper Ultra Tape', uplift_pct: 7, note: null, changed_at: '2026-08-11T02:00:00Z' },
];

// Made-up suggestions so the anchor panel has something to show.
const DEMO_SUGGESTIONS = {
  fairprice: { anchor_pct: 25, months_used: 18 },
  nhg: { anchor_pct: 20, months_used: 9 },
};

const SCOPE_ORDER = ['sku', 'range', 'customer', 'all'];

// The demo has no SKU catalogue; these are the codes it uses, with the
// product names the Scenario builder shows.
const DEMO_PRODUCTS = {
  13255045: 'Aire Adult Pants L',
  13255044: 'Aire Adult Pants S/M',
  13271340: 'Aire Ultra Pants L',
};

let nextUpliftId = 1;
let nextAnchorId = 1;
let nextCustomerId = 1;

const state = {
  customers: [],
  uplifts: [],
  anchors: [],
};

function now() {
  return new Date().toISOString();
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function addUplift(values) {
  const row = {
    id: nextUpliftId++,
    evidence_months: null,
    note: null,
    changed_at: now(),
    superseded_at: null,
    archived_at: null,
    customer_id: null,
    sku_range: null,
    sku: null,
    ...values,
  };
  state.uplifts.push(row);
  return row;
}

function addAnchor(customerId, anchorPct, source, changedBy = CHANGED_BY, changedAt = now()) {
  state.anchors.push({
    id: nextAnchorId++,
    customer_id: customerId,
    anchor_pct: anchorPct,
    source,
    changed_by: changedBy,
    changed_at: changedAt,
    superseded_at: null,
  });
}

function ensureCustomer(name) {
  let customer = state.customers.find((row) => row.customer_name === name);
  if (!customer) {
    customer = { customer_id: nextCustomerId++, customer_name: name };
    state.customers.push(customer);
  }
  return customer;
}

for (const [key, label, discount, uplift] of SEED_MECHANICS) {
  addUplift({
    mechanic_key: key,
    mechanic_label: label,
    effective_discount_pct: discount,
    scope: 'all',
    uplift_pct: uplift,
    source: 'rule_based',
    changed_by: 'seed',
    changed_at: null,
  });
}
addAnchor(null, 20, 'manual', 'seed');
['fairprice', 'nhg', 'sheng_shiong'].forEach(ensureCustomer);

for (const [key, version] of DEMO_HISTORY) {
  const current = state.uplifts.find((row) => row.mechanic_key === key && row.scope === 'all' && !row.superseded_at);
  current.superseded_at = version.changed_at;
  const kept = { ...current };
  delete kept.id;
  addUplift({ ...kept, superseded_at: null, ...version, changed_by: CHANGED_BY });
}

for (const [name, version] of DEMO_ANCHOR_HISTORY) {
  const customerId = ensureCustomer(name).customer_id;
  const current = state.anchors.find((row) => row.customer_id === customerId && !row.superseded_at);
  if (current) current.superseded_at = version.changed_at;
  addAnchor(customerId, version.anchor_pct, version.source, CHANGED_BY, version.changed_at);
}

for (const { customer_name: name, ...values } of DEMO_OVERRIDES) {
  const base = state.uplifts.find((row) => row.mechanic_key === values.mechanic_key && row.scope === 'all');
  addUplift({
    mechanic_key: base.mechanic_key,
    mechanic_label: base.mechanic_label,
    effective_discount_pct: base.effective_discount_pct,
    customer_id: ensureCustomer(name).customer_id,
    source: 'estimate',
    changed_by: CHANGED_BY,
    ...values,
  });
}

// ---- views (same shapes as the backend) ------------------------------------------

function customerName(id) {
  return state.customers.find((row) => row.customer_id === id)?.customer_name ?? null;
}

function upliftView(row) {
  return {
    ...row,
    customer_name: customerName(row.customer_id),
    follows_rule: row.source === 'rule_based' && row.effective_discount_pct != null,
    capped: false,
  };
}

function currentUplifts() {
  return state.uplifts.filter((row) => row.superseded_at === null);
}

function currentAnchor(customerId) {
  return state.anchors.find((row) => row.customer_id === customerId && row.superseded_at === null) ?? null;
}

function defaultAnchorPct() {
  return currentAnchor(null)?.anchor_pct ?? 20;
}

function anchorView(customer) {
  const demo = DEMO_SUGGESTIONS[customer.customer_name];
  const suggested = demo
    ? { ...demo, first_month: '2025-03-01', last_month: '2026-08-01' }
    : null;
  const row = currentAnchor(customer.customer_id);

  let anchorPct = defaultAnchorPct();
  let source = 'default';
  if (row?.source === 'manual') {
    anchorPct = row.anchor_pct;
    source = 'manual';
  } else if (suggested) {
    anchorPct = suggested.anchor_pct;
    source = 'suggested';
  }

  return {
    customer_id: customer.customer_id,
    customer_name: customer.customer_name,
    anchor_pct: anchorPct,
    source,
    suggested,
    default_anchor_pct: defaultAnchorPct(),
    changed_by: row?.changed_by ?? null,
    changed_at: row?.changed_at ?? null,
  };
}

function findCustomer(customerId) {
  const customer = state.customers.find((row) => row.customer_id === customerId);
  if (!customer) fail(404, `Customer ${customerId} does not exist.`);
  return customer;
}

function lockedRow(settingId) {
  const row = state.uplifts.find((item) => item.id === settingId);
  if (!row) fail(404, `Uplift setting ${settingId} does not exist.`);
  if (row.superseded_at) fail(409, `Uplift setting ${settingId} has been replaced by a newer version; reload and try again.`);
  if (row.source === 'learned') fail(409, 'Learned values are set by the forecasting model after each retrain and cannot be edited.');
  if (row.archived_at) fail(409, 'This value is archived; restore it before changing it.');
  return row;
}

function supersede(row) {
  row.superseded_at = now();
}

// A new version of a row: same mechanic and scope, new id and timestamps.
function newVersion(row, changes) {
  const kept = { ...row };
  delete kept.id;
  delete kept.changed_at;
  delete kept.superseded_at;
  return addUplift({ ...kept, ...changes, changed_by: CHANGED_BY });
}

function applies(row, customerId, sku) {
  if (row.scope === 'all') return true;
  if (row.customer_id !== customerId) return false;
  if (row.scope === 'customer') return true;
  // The demo has no SKU catalogue: a SKU value matches its code or its product name.
  return row.scope === 'sku' && sku != null && (row.sku === sku || DEMO_PRODUCTS[row.sku] === sku);
}

function pick(customerId, sku, anchorPct) {
  const chosen = new Map();
  for (const row of currentUplifts()) {
    if (row.archived_at || !applies(row, customerId, sku)) continue;
    const current = chosen.get(row.mechanic_key);
    if (!current || SCOPE_ORDER.indexOf(row.scope) < SCOPE_ORDER.indexOf(current.scope)) {
      chosen.set(row.mechanic_key, row);
    }
  }
  return [...chosen.values()]
    .map((row) => {
      const view = upliftView(row);
      if (view.follows_rule) {
        view.uplift_pct = ruleBasedUplift(row.effective_discount_pct, anchorPct, currentRate());
        view.capped = ruleBasedUpliftCapped(row.effective_discount_pct, anchorPct, currentRate());
      }
      return view;
    })
    .sort((a, b) => (a.effective_discount_pct ?? Infinity) - (b.effective_discount_pct ?? Infinity));
}

// ---- the same functions settingsApi.js exports -------------------------------------

export async function getPromoUpliftSettings() {
  // Same order as the backend's _current_uplift_rows.
  const rows = [...currentUplifts()].sort(
    (a, b) =>
      (a.effective_discount_pct ?? Infinity) - (b.effective_discount_pct ?? Infinity) ||
      a.mechanic_key.localeCompare(b.mechanic_key) ||
      a.id - b.id
  );
  return copy({
    settings: rows.map(upliftView),
    default_anchor_pct: defaultAnchorPct(),
    unmapped_mechanics: [],
    rule: ruleView(),
  });
}

export async function getResolvedPromoUplifts({ customer, product = '' }) {
  const row = ensureCustomer(customer);
  const anchor = anchorView(row);
  const uplifts = pick(row.customer_id, product || null, anchor.anchor_pct);

  const productUplifts = {};
  const productSources = {};
  if (!product) {
    const customerValues = Object.fromEntries(uplifts.map((view) => [view.mechanic_key, view.uplift_pct]));
    const skus = new Set(
      currentUplifts()
        .filter((item) => item.scope === 'sku' && item.customer_id === row.customer_id)
        .map((item) => item.sku)
    );
    for (const sku of skus) {
      const differing = {};
      const sources = {};
      for (const view of pick(row.customer_id, sku, anchor.anchor_pct)) {
        if (view.uplift_pct !== customerValues[view.mechanic_key]) {
          differing[view.mechanic_key] = view.uplift_pct;
          sources[view.mechanic_key] = { source: view.source, evidence_months: view.evidence_months ?? null };
        }
      }
      const name = DEMO_PRODUCTS[sku] ?? sku;
      if (Object.keys(differing).length) {
        productUplifts[name] = differing;
        productSources[name] = sources;
      }
    }
  }

  return copy({
    customer_name: row.customer_name,
    product_name: product || null,
    anchor,
    uplifts,
    product_uplifts: productUplifts,
    product_sources: productSources,
  });
}

export async function savePromoUplift(settingId, { uplift_pct: upliftPct, note = null }) {
  const row = lockedRow(settingId);
  if (row.source === 'estimate' && row.uplift_pct === upliftPct && row.note === note) {
    return copy({ changed: false, setting: upliftView(row) });
  }
  supersede(row);
  const next = newVersion(row, { uplift_pct: upliftPct, note, source: 'estimate' });
  return copy({ changed: true, setting: upliftView(next) });
}

export async function resetPromoUplift(settingId) {
  const row = lockedRow(settingId);
  if (row.source === 'rule_based') return copy({ changed: false, setting: upliftView(row) });

  supersede(row);
  if (row.scope !== 'all') return { changed: true, setting: null };

  const seed = SEED_MECHANICS.find(([key]) => key === row.mechanic_key);
  const upliftPct =
    row.effective_discount_pct != null ? ruleBasedUplift(row.effective_discount_pct, 20, currentRate()) : seed?.[3] ?? 0;
  const next = newVersion(row, { uplift_pct: upliftPct, note: null, source: 'rule_based' });
  return copy({ changed: true, setting: upliftView(next) });
}

export async function archivePromoUplift(settingId) {
  const row = lockedRow(settingId);
  supersede(row);
  const next = newVersion(row, { archived_at: now() });
  return copy({ changed: true, setting: upliftView(next) });
}

export async function restorePromoUplift(settingId) {
  const row = state.uplifts.find((item) => item.id === settingId);
  if (!row) fail(404, `Uplift setting ${settingId} does not exist.`);
  if (row.superseded_at) fail(409, `Uplift setting ${settingId} has been replaced by a newer version; reload and try again.`);
  if (!row.archived_at) return copy({ changed: false, setting: upliftView(row) });
  supersede(row);
  const next = newVersion(row, { archived_at: null });
  return copy({ changed: true, setting: upliftView(next) });
}

export async function addPromoMechanic({ kind, mechanic_label: label, effective_discount_pct: discount = null, uplift_pct: upliftPct = null, note = null }) {
  const key = `${kind === 'voucher' ? 'voucher_' : ''}${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
  const taken = currentUplifts().some(
    (row) => row.scope === 'all' && (row.mechanic_key === key || row.mechanic_label.toLowerCase() === label.toLowerCase())
  );
  if (taken) fail(409, `"${label}" already exists; edit that one instead.`);

  // No typed uplift: a rule-based uplift that follows the rule, like the seeds.
  const isRuleBased = upliftPct == null;
  const row = addUplift({
    mechanic_key: key,
    mechanic_label: label,
    kind,
    effective_discount_pct: discount,
    scope: 'all',
    uplift_pct: isRuleBased ? ruleBasedUplift(discount ?? 20, defaultAnchorPct(), currentRate()) : upliftPct,
    source: isRuleBased ? 'rule_based' : 'estimate',
    note,
    changed_by: CHANGED_BY,
  });
  return copy({ changed: true, setting: upliftView(row) });
}

export async function addPromoUpliftOverride(payload) {
  findCustomer(payload.customer_id);
  const base = currentUplifts().find((row) => row.mechanic_key === payload.mechanic_key && row.scope === 'all');
  if (!base) fail(404, `Mechanic ${payload.mechanic_key} does not exist.`);

  const duplicate = currentUplifts().some(
    (row) =>
      row.mechanic_key === payload.mechanic_key &&
      row.scope === payload.scope &&
      row.customer_id === payload.customer_id &&
      (row.sku_range ?? null) === (payload.sku_range ?? null) &&
      (row.sku ?? null) === (payload.sku ?? null)
  );
  if (duplicate) fail(409, `${base.mechanic_label} already has a value at this scope; edit that one instead.`);

  const row = addUplift({
    mechanic_key: base.mechanic_key,
    mechanic_label: base.mechanic_label,
    effective_discount_pct: base.effective_discount_pct,
    scope: payload.scope,
    customer_id: payload.customer_id,
    sku_range: payload.sku_range ?? null,
    sku: payload.sku ?? null,
    uplift_pct: payload.uplift_pct,
    note: payload.note ?? null,
    source: 'estimate',
    changed_by: CHANGED_BY,
  });
  return copy({ changed: true, setting: upliftView(row) });
}

export async function getPromoUpliftHistory(mechanicKey) {
  const rows = state.uplifts.filter((row) => row.mechanic_key === mechanicKey);
  if (!rows.length) fail(404, `Mechanic ${mechanicKey} does not exist.`);
  return copy([...rows].reverse().map(upliftView));
}

export async function getPromoAnchors() {
  return copy({ default_anchor_pct: defaultAnchorPct(), customers: state.customers.map(anchorView) });
}

export async function savePromoAnchor(customerId, anchorPct) {
  if (customerId != null) findCustomer(customerId);
  const current = currentAnchor(customerId);
  const changed = !(current?.source === 'manual' && current.anchor_pct === anchorPct);
  if (changed) {
    if (current) supersede(current);
    addAnchor(customerId, anchorPct, 'manual');
  }
  if (customerId == null) return { changed, default_anchor_pct: defaultAnchorPct() };
  return copy({ changed, anchor: anchorView(findCustomer(customerId)) });
}

export async function resetPromoAnchor(customerId) {
  const customer = findCustomer(customerId);
  const current = currentAnchor(customerId);
  const changed = current?.source === 'manual';
  if (changed) {
    supersede(current);
    addAnchor(customerId, null, 'suggested');
  }
  return copy({ changed, anchor: anchorView(customer) });
}

export async function getPromoAnchorHistory(customerId) {
  findCustomer(customerId);
  return copy(
    state.anchors
      .filter((row) => row.customer_id === customerId)
      .reverse()
      .map((row) => ({ ...row, is_current: row.superseded_at === null }))
  );
}

// ---- measurement (same shapes as backend promo_measurement.py) ------------------------
//
// The demo "measures" a fixed, made-up result for Fairprice so every part of
// the page can be clicked through. Real values come from sales data.

const DEMO_MEASURED = [
  { mechanic_key: 'b2g1', customer_name: 'fairprice', value: 6.4, n: 8.6, skuOwn: null, customerOwn: 7.1, ruleBased: 3 },
  { mechanic_key: 'pct_off_30', customer_name: 'fairprice', value: 5.2, n: 8.2, skuOwn: null, customerOwn: 5.9, ruleBased: 2 },
  { mechanic_key: 'b2_pct_off_25', customer_name: 'fairprice', value: 1.1, n: 7.4, skuOwn: null, customerOwn: 0.6, ruleBased: 0 },
  { mechanic_key: 'pct_off_25', customer_name: 'fairprice', value: 0.8, n: 2.5, skuOwn: null, customerOwn: 1.4, ruleBased: 0 },
  { mechanic_key: 'b1g1', customer_name: 'fairprice', sku: '13255045', value: 14.6, n: 1.4, skuOwn: 22.0, customerOwn: 9.1, blendedCustomer: 9.4, ruleBased: 10 },
];

const measurement = { runs: [], results: {}, notes: [] };
let nextRunId = 1;
let nextNoteId = 1;

function demoRun(status, counts) {
  const time = now();
  const run = {
    run_id: nextRunId++,
    triggered_by: 'button',
    status,
    started_at: time,
    finished_at: time,
    window_start: '2025-01-01',
    window_end: '2026-08-31',
    counts,
    warnings: [],
    error: null,
  };
  measurement.runs.unshift(run);
  return run;
}

function runSummary(run) {
  return copy({
    run_id: run.run_id,
    status: run.status,
    window_start: run.window_start,
    window_end: run.window_end,
    counts: run.counts,
    warnings: run.warnings,
  });
}

function nextDue() {
  // Next 04:00 Singapore time (20:00 UTC), as the real schedule.
  const due = new Date();
  due.setUTCHours(20, 0, 0, 0);
  if (due <= new Date()) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString();
}

function measureOne(item, run, counts) {
  const customer = ensureCustomer(item.customer_name);
  const scope = item.sku ? 'sku' : 'customer';
  const base = currentUplifts().find((row) => row.mechanic_key === item.mechanic_key && row.scope === 'all');
  const existing = currentUplifts().find(
    (row) =>
      row.mechanic_key === item.mechanic_key &&
      row.scope === scope &&
      row.customer_id === customer.customer_id &&
      (row.sku ?? null) === (item.sku ?? null)
  );
  const result = {
    run_id: run.run_id,
    run_finished_at: run.finished_at,
    customer_id: customer.customer_id,
    sku: item.sku ?? null,
    mechanic_key: item.mechanic_key,
    method: 'trend',
    n: item.sku ? item.n : null,
    big_n: item.sku ? 9 : item.n,
    sku_own_pct: item.skuOwn,
    customer_own_pct: item.customerOwn,
    rule_based_pct: item.ruleBased,
    blended_customer_pct: item.sku ? item.blendedCustomer : item.value,
    starting_weight: 3,
    blended_pct: item.value,
    backtest_pct: 4.1,
    backtest_months: 2,
    outcome: 'applied',
    reason: null,
    window_start: run.window_start,
    window_end: run.window_end,
  };

  if (existing?.source === 'estimate') {
    measurement.results[existing.id] = { ...result, outcome: 'estimate_pending', reason: 'Typed value kept; see the note.' };
    measurement.notes.push({
      id: nextNoteId++,
      note_type: 'uplift',
      customer_id: customer.customer_id,
      customer_name: customer.customer_name,
      mechanic_key: item.mechanic_key,
      sku: item.sku ?? null,
      product_name: DEMO_PRODUCTS[item.sku] ?? null,
      setting_id: existing.id,
      anchor_id: null,
      user_value: existing.uplift_pct,
      measured_value: item.value,
      evidence_months: item.n,
      created_at: run.finished_at,
      status: 'open',
    });
    counts.estimate_pending += 1;
    counts.notes_opened += 1;
    return;
  }

  if (existing) supersede(existing);
  const row = addUplift({
    mechanic_key: base.mechanic_key,
    mechanic_label: base.mechanic_label,
    kind: base.kind ?? 'promotion',
    effective_discount_pct: base.effective_discount_pct,
    scope,
    customer_id: customer.customer_id,
    sku: item.sku ?? null,
    uplift_pct: item.value,
    source: 'measured',
    evidence_months: item.n,
    changed_by: 'measurement',
  });
  measurement.results[row.id] = result;
  counts.applied += 1;
}

export async function runPromoMeasurement() {
  // Nothing in the demo changes between runs, so a second run is skipped, as
  // the real job skips when no input changed.
  if (measurement.runs.some((run) => run.status.startsWith('succeeded'))) {
    return runSummary(demoRun('skipped_unchanged', {}));
  }

  const counts = {
    applied: 0,
    unchanged: 0,
    held_backtest: 0,
    no_evidence: 0,
    estimate_pending: 0,
    skipped: 0,
    notes_opened: 0,
    notes_closed: 0,
    mechanics_created: 0,
  };
  const run = demoRun('succeeded', counts);
  for (const item of DEMO_MEASURED) measureOne(item, run, counts);
  return runSummary(run);
}

export async function getPromoMeasurementStatus() {
  const lastSuccess = measurement.runs.find((run) => run.status !== 'failed') ?? null;
  return copy({
    last_run: measurement.runs[0] ?? null,
    last_success: lastSuccess,
    next_due: nextDue(),
    stale: lastSuccess == null,
    stale_days: 100,
    open_notes: measurement.notes.filter((note) => note.status === 'open').length,
  });
}

export async function getPromoUpliftEvidence(settingId) {
  if (!state.uplifts.some((item) => item.id === settingId)) fail(404, `Uplift setting ${settingId} does not exist.`);
  return copy({ setting_id: settingId, result: measurement.results[settingId] ?? null });
}

export async function getPromoUpliftNotes() {
  return copy(measurement.notes.filter((note) => note.status === 'open'));
}

function openNote(noteId) {
  const note = measurement.notes.find((item) => item.id === noteId);
  if (!note) fail(404, `Note ${noteId} does not exist.`);
  if (note.status !== 'open') fail(409, 'This note has already been dealt with; reload the page.');
  return note;
}

export async function applyPromoMeasuredValue(noteId) {
  const note = openNote(noteId);
  const row = lockedRow(note.setting_id);
  supersede(row);
  const next = newVersion(row, { uplift_pct: note.measured_value, source: 'measured', evidence_months: note.evidence_months });
  measurement.results[next.id] = { ...measurement.results[row.id], outcome: 'applied', reason: null };
  note.status = 'used_measured';
  return { changed: true };
}

export async function keepPromoTypedValue(noteId) {
  const note = openNote(noteId);
  note.status = 'kept_mine';
  note.declined_value = note.measured_value;
  return { changed: true };
}

// ---- the rule behind rule-based uplifts (same shapes as backend get_rule) ---------

const ruleVersions = [{ id: 1, uplift_per_point_pct: DEFAULT_UPLIFT_PER_POINT_PCT, changed_by: 'seed', changed_at: null, superseded_at: null }];

function currentRate() {
  return ruleVersions.find((row) => row.superseded_at === null)?.uplift_per_point_pct ?? DEFAULT_UPLIFT_PER_POINT_PCT;
}

function ruleView() {
  const current = ruleVersions.find((row) => row.superseded_at === null);
  const rate = currentRate();
  return {
    uplift_per_point_pct: rate,
    default_uplift_per_point_pct: DEFAULT_UPLIFT_PER_POINT_PCT,
    is_default: rate === DEFAULT_UPLIFT_PER_POINT_PCT,
    warning: rate > RULE_WARNING_ABOVE_PCT ? RULE_WARNING : null,
    changed_by: current?.changed_by ?? null,
    changed_at: current?.changed_at ?? null,
  };
}

function writeRule(rate) {
  const changed = rate !== currentRate();
  if (changed) {
    const current = ruleVersions.find((row) => row.superseded_at === null);
    if (current) current.superseded_at = now();
    ruleVersions.push({ id: ruleVersions.length + 1, uplift_per_point_pct: rate, changed_by: CHANGED_BY, changed_at: now(), superseded_at: null });
  }
  const rule = ruleView();
  return copy({ changed, rule, warning: rule.warning });
}

export async function getPromoRule() {
  const history = [...ruleVersions]
    .reverse()
    .map((row) => ({ ...row, is_current: row.superseded_at === null }));
  return copy({ ...ruleView(), history });
}

export async function savePromoRule(upliftPerPointPct) {
  if (!(upliftPerPointPct > 0)) fail(422, 'The rate must be more than 0% per point.');
  return writeRule(upliftPerPointPct);
}

export async function resetPromoRule() {
  return writeRule(DEFAULT_UPLIFT_PER_POINT_PCT);
}
