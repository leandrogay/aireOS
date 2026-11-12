import test from 'node:test';
import assert from 'node:assert/strict';

import { promotionUpliftDetails, resolvedUpliftDetails, snapshotUpliftDetails } from '../app/utils/promotionUpliftDetails.js';
import { liveUpliftIndex, liveUpliftValues } from '../app/utils/scenarioLiveUplifts.js';

const anchor = { anchor_pct: 20, mechanic_label: '20% Off', effective_from: null };
const rule = (product, value, discount = 30) => ({ product_name: product, level: 'placeholder', uplift_pct: value,
  placeholder: { discount_pct: discount, anchor_pct: 20 }, moments: [] });
const measured = { product_name: 'Pants L', level: 'measured', uplift_pct: 9,
  moments: [6, 9, 12].map((pct, i) => ({ month: `2026-0${i + 1}-01`, uplift_pct: pct, used_pct: pct })) };
const index = liveUpliftIndex([
  { customer_name: 'FairPrice', sku_range: 'Pants', mechanic_key: 'pct_off_30', versions: [
    { effective_from: '2026-11-01', anchor, skus: [rule('Pants M', 4), measured] },
    { effective_from: '2027-06-01', anchor: { ...anchor, anchor_pct: 15, mechanic_label: '15% Off', effective_from: '2027-06-01' },
      skus: [{ ...rule('Pants M', 6), placeholder: { discount_pct: 30, anchor_pct: 15 } }, { ...measured, uplift_pct: null, level: 'unavailable' }] },
  ] },
  { customer_name: 'NHG', sku_range: 'Pants', mechanic_key: 'pct_off_30', versions: [
    { effective_from: '2026-11-01', anchor, skus: [rule('Pants M', -2, 15)] },
  ] },
]);
const catalog = { product_ranges: { 'Pants M': 'Pants', 'Pants L': 'Pants', 'Tape S': 'Tape' } };
const promotion = {
  customers: ['FairPrice'], skuRanges: ['Pants'], mechanicKey: 'pct_off_30',
  startMonth: '2027-01-01', endMonth: '2027-07-01', overrideUpliftPct: null,
  references: { FairPrice: { referenceUpliftPct: 4, referenceSource: 'placeholder', referenceBySku: { 'Pants L': 7 } } },
};

test('each product shows its own rule or measured moments and the months its anchor applies', () => {
  const rows = promotionUpliftDetails(promotion, { liveIndex: index, upliftsByCustomer: { FairPrice: catalog } });
  assert.equal(rows.length, 4);
  const pants = rows.filter((row) => row.product === 'Pants M');
  assert.deepEqual(pants.map((row) => [row.fromMonth, row.toMonth, row.expectedPct]), [
    ['2027-01-01', '2027-05-01', 4], ['2027-06-01', '2027-07-01', 6],
  ]);
  assert.match(pants[1].lines.join(' '), /30% − 15%.*\+6%/);
  const learned = rows.find((row) => row.level === 'measured');
  assert.match(learned.lines.join(' '), /latest 3 moments/);
  assert.match(learned.lines.join(' '), /Jan 2026: \+6%/);
});

test('a product without a usable live value shows the saved fallback actually used by the engine', () => {
  const rows = promotionUpliftDetails(promotion, { liveIndex: index });
  const fallback = rows.find((row) => row.product === 'Pants L' && row.fromMonth === '2027-06-01');
  assert.equal(fallback.expectedPct, 7);
  assert.equal(fallback.kind, 'saved');
  assert.deepEqual(fallback.lines, []);
});

test('customers have separate expected values and switched-off customer/range pairs are omitted', () => {
  const both = { ...promotion, customers: ['FairPrice', 'NHG'], endMonth: '2027-01-01' };
  const rows = promotionUpliftDetails(both, { liveIndex: index });
  assert.equal(rows.find((row) => row.customer === 'NHG').expectedPct, -2);
  const without = promotionUpliftDetails({ ...both, excludedPairs: [{ customer: 'NHG', skuRange: 'Pants' }] }, { liveIndex: index });
  assert.ok(without.every((row) => row.customer === 'FairPrice'));
});

test('all customers includes saved references and legacy single-SKU promotions stay on that SKU', () => {
  const rows = promotionUpliftDetails({ ...promotion, customers: [], skuRanges: [], sku: 'Pants M' }, { liveIndex: index,
    upliftsByCustomer: { FairPrice: catalog, NHG: catalog } });
  assert.deepEqual([...new Set(rows.map((row) => row.customer))], ['FairPrice', 'NHG']);
  assert.ok(rows.every((row) => row.product === 'Pants M'));
});

test('a zero override changes the used value while preserving each expected derivation', () => {
  const rows = promotionUpliftDetails({ ...promotion, overrideUpliftPct: 0 }, { liveIndex: index });
  assert.ok(rows.every((row) => row.appliedPct === 0));
  assert.ok(rows.some((row) => row.expectedPct === 9 && row.lines.length > 1));
});

test('copied calculations keep their source moments after settings change', () => {
  const details = snapshotUpliftDetails(liveUpliftValues(index, { ...promotion, customer: 'FairPrice', endMonth: promotion.startMonth }));
  const frozen = { ...promotion, references: { FairPrice: { ...promotion.references.FairPrice,
    referenceBySku: { 'Pants L': 9 }, referenceDetails: details } } };
  const rows = promotionUpliftDetails(frozen, { upliftsByCustomer: { FairPrice: { ...catalog, product_uplifts: { 'Pants L': { pct_off_30: 99 } } } } });
  assert.equal(rows.find((row) => row.product === 'Pants L').expectedPct, 9);
  assert.match(rows.find((row) => row.product === 'Pants L').lines.join(' '), /latest 3 moments/);
  assert.equal(rows.length, 2);
});

test('new resolved references retain the selected range rule and its own anchor', () => {
  const resolved = { ...catalog, range_basis: { Pants: { pct_off_30: {
    uplift_pct: 4, source: 'placeholder', follows_anchor: true, discount_pct: 30, anchor_pct: 20,
  } } } };
  const details = resolvedUpliftDetails(resolved, promotion, { referenceUpliftPct: 4, referenceSource: 'placeholder' });
  assert.equal(details.length, 2);
  assert.match(details[0].lines.join(' '), /Rule estimate: \(30% − 20%\) ÷ 5 × 2 = \+4%/);
  assert.doesNotMatch(details[0].lines.join(' '), /Fewer than/);
});

test('an old reference never gets a newly reconstructed calculation from current settings', () => {
  const rows = promotionUpliftDetails(promotion, { upliftsByCustomer: { FairPrice: catalog } });
  assert.ok(rows.every((row) => row.kind === 'saved' && row.lines.length === 0));
  assert.deepEqual(rows.map((row) => row.expectedPct), [4, 7]);
});
