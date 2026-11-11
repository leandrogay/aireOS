import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcStatus,
  explanationLines,
  filterCalculatedRows,
  levelLabel,
  skusDiffer,
  upcomingText,
  upliftText,
} from '../app/utils/promoUpliftCalc.js';

const ANCHOR = { mechanic_label: '20% Off', anchor_pct: 20, effective_from: null };

function version(min, max, effectiveFrom = '2026-11-01') {
  return { effective_from: effectiveFrom, uplift_min: min, uplift_max: max, skus: [] };
}

// ---- values ------------------------------------------------------------------------

test('a range whose SKUs agree shows one value, and one that differs shows the spread', () => {
  assert.equal(upliftText(version(4, 4)), '+4%');
  assert.equal(upliftText(version(-2, 9)), '−2% to +9%');
  assert.equal(upliftText(version(null, null)), '—');
});

test('the next anchor version is the second line', () => {
  const row = { versions: [version(4, 4), version(6, 6, '2027-06-01')] };

  assert.equal(upcomingText(row), 'from Jun 2027: +6%');
  assert.equal(upcomingText({ versions: [version(4, 4)] }), null);
});

test('a row opens to its SKUs only when they differ', () => {
  const same = { skus: [{ level: 'placeholder', uplift_pct: 4 }, { level: 'placeholder', uplift_pct: 4 }] };
  const mixed = { skus: [{ level: 'measured', uplift_pct: 9 }, { level: 'placeholder', uplift_pct: 4 }] };

  assert.equal(skusDiffer(same), false);
  assert.equal(skusDiffer(mixed), true);
});

test('every level has its label', () => {
  assert.equal(levelLabel('measured_earlier'), 'Measured · includes earlier anchor');
  assert.equal(levelLabel('placeholder'), 'Placeholder · rule');
});

// ---- the 'i' card ----------------------------------------------------------------

test('a placeholder explains its sum against the anchor', () => {
  const lines = explanationLines(
    { level: 'placeholder', uplift_pct: 4, moments: [], placeholder: { discount_pct: 30, anchor_pct: 20 } },
    ANCHOR,
  );

  assert.deepEqual(lines, [
    'Anchor: 20% Off · 20%.',
    'Fewer than 3 moments, so the rule: (30% − 20%) ÷ 5 × 2 = +4%.',
  ]);
});

test('a measured value lists its months and says which were converted from an earlier anchor', () => {
  const lines = explanationLines(
    {
      level: 'measured_earlier',
      uplift_pct: 5,
      placeholder: null,
      moments: [
        { month: '2026-08-01', uplift_pct: 3, used_pct: 1, converted: { source: 'placeholder' }, baseline_source: 'version' },
        { month: '2026-12-01', uplift_pct: 7, used_pct: 7, converted: null, baseline_source: 'all_time' },
      ],
    },
    { ...ANCHOR, mechanic_label: '15% Off', anchor_pct: 15, effective_from: '2026-12-01' },
  );

  assert.deepEqual(lines, [
    'Anchor: 15% Off · 15% from Dec 2026.',
    'Average of the latest 2 moments:',
    'Aug 2026: +1% (+3% against an earlier anchor, converted by the placeholder rule)',
    'Dec 2026: +7%, against every month at the anchor',
  ]);
});

// ---- filters and status ----------------------------------------------------------

test('"All" filters show every combination', () => {
  const rows = [
    { customer_name: 'FairPrice', sku_range: 'Pants', mechanic_key: 'pct_off_30' },
    { customer_name: 'NHG', sku_range: 'Pants', mechanic_key: 'pct_off_30' },
    { customer_name: 'NHG', sku_range: 'Tape', mechanic_key: 'b1g1' },
  ];

  assert.equal(filterCalculatedRows(rows, { customer: '', skuRange: '', mechanic: '' }).length, 3);
  assert.equal(filterCalculatedRows(rows, { customer: '', skuRange: 'Pants', mechanic: '' }).length, 2);
  assert.equal(filterCalculatedRows(rows, { customer: 'NHG', skuRange: '', mechanic: 'b1g1' }).length, 1);
});

test('a failed run wins over waiting, and waiting over up to date', () => {
  const done = { calculated_at: '2026-11-11T00:00:00Z', pending: false, last_error: null };

  assert.deepEqual(calcStatus({ 1: done, 2: { ...done, last_error: 'RuntimeError: x' }, 3: { ...done, pending: true } }), {
    label: 'Last run failed', tone: 'danger', error: 'RuntimeError: x',
  });
  assert.equal(calcStatus({ 1: done, 2: { ...done, pending: true } }).label, 'Waiting to recalculate');
  assert.equal(calcStatus({ 1: done }).label, 'Up to date');
});
