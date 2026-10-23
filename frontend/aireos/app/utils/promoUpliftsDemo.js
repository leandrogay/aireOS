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
// typed value becomes an 'estimate', reset goes back to the placeholder.
//
// NOTHING IS SAVED: the state lives in this browser tab and resets on reload.
// The "suggested" discounts below are made up for the demo; the real ones
// are calculated from each customer's promotions.
//
// To go live: set PROMO_UPLIFTS_DEMO to false in
// app/services/promoUpliftsApi.js and delete this file.

import { placeholderUplift } from '@/app/utils/promoUpliftSettings';

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

// Made-up suggestions so the anchor panel has something to show.
const DEMO_SUGGESTIONS = {
  fairprice: { anchor_pct: 25, months_used: 18 },
  nhg: { anchor_pct: 20, months_used: 9 },
};

const SCOPE_ORDER = ['sku', 'range', 'customer', 'all'];

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
    customer_id: null,
    sku_range: null,
    sku: null,
    ...values,
  };
  state.uplifts.push(row);
  return row;
}

function addAnchor(customerId, anchorPct, source, changedBy = CHANGED_BY) {
  state.anchors.push({
    id: nextAnchorId++,
    customer_id: customerId,
    anchor_pct: anchorPct,
    source,
    changed_by: changedBy,
    changed_at: now(),
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
    source: 'placeholder',
    changed_by: 'seed',
    changed_at: null,
  });
}
addAnchor(null, 20, 'manual', 'seed');
['fairprice', 'nhg', 'sheng_shiong'].forEach(ensureCustomer);

// ---- views (same shapes as the backend) ------------------------------------------

function customerName(id) {
  return state.customers.find((row) => row.customer_id === id)?.customer_name ?? null;
}

function upliftView(row) {
  return {
    ...row,
    customer_name: customerName(row.customer_id),
    follows_anchor: row.source === 'placeholder' && row.effective_discount_pct != null,
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
  // The demo has no SKU catalogue, so a SKU value is matched on the product name.
  return row.scope === 'sku' && sku != null && row.sku === sku;
}

function pick(customerId, sku, anchorPct) {
  const chosen = new Map();
  for (const row of currentUplifts()) {
    if (!applies(row, customerId, sku)) continue;
    const current = chosen.get(row.mechanic_key);
    if (!current || SCOPE_ORDER.indexOf(row.scope) < SCOPE_ORDER.indexOf(current.scope)) {
      chosen.set(row.mechanic_key, row);
    }
  }
  return [...chosen.values()]
    .map((row) => {
      const view = upliftView(row);
      if (view.follows_anchor) view.uplift_pct = placeholderUplift(row.effective_discount_pct, anchorPct);
      return view;
    })
    .sort((a, b) => (a.effective_discount_pct ?? Infinity) - (b.effective_discount_pct ?? Infinity));
}

// ---- the same functions settingsApi.js exports -------------------------------------

export async function getPromoUpliftSettings() {
  return copy({
    settings: currentUplifts().map(upliftView),
    default_anchor_pct: defaultAnchorPct(),
    unmapped_mechanics: [],
  });
}

export async function getResolvedPromoUplifts({ customer, product = '' }) {
  const row = ensureCustomer(customer);
  const anchor = anchorView(row);
  const uplifts = pick(row.customer_id, product || null, anchor.anchor_pct);

  const productUplifts = {};
  if (!product) {
    const customerValues = Object.fromEntries(uplifts.map((view) => [view.mechanic_key, view.uplift_pct]));
    const skus = new Set(
      currentUplifts()
        .filter((item) => item.scope === 'sku' && item.customer_id === row.customer_id)
        .map((item) => item.sku)
    );
    for (const sku of skus) {
      const differing = {};
      for (const view of pick(row.customer_id, sku, anchor.anchor_pct)) {
        if (view.uplift_pct !== customerValues[view.mechanic_key]) differing[view.mechanic_key] = view.uplift_pct;
      }
      if (Object.keys(differing).length) productUplifts[sku] = differing;
    }
  }

  return copy({
    customer_name: row.customer_name,
    product_name: product || null,
    anchor,
    uplifts,
    product_uplifts: productUplifts,
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
  if (row.source === 'placeholder') return copy({ changed: false, setting: upliftView(row) });

  supersede(row);
  if (row.scope !== 'all') return { changed: true, setting: null };

  const seed = SEED_MECHANICS.find(([key]) => key === row.mechanic_key);
  const upliftPct = row.effective_discount_pct != null ? placeholderUplift(row.effective_discount_pct, 20) : seed?.[3] ?? 0;
  const next = newVersion(row, { uplift_pct: upliftPct, note: null, source: 'placeholder' });
  return copy({ changed: true, setting: upliftView(next) });
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
