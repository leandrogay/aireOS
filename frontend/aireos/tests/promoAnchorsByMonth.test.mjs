import test from 'node:test';
import assert from 'node:assert/strict';

import { anchorInMonth, anchorTargets } from '../app/utils/promoUpliftSettings.js';

const ANCHORS = {
  customers: [
    {
      customer_id: 1,
      customer_name: 'FairPrice',
      anchor_pct: 20,
      mechanic_label: '20% Off',
      source: 'recommended',
      upcoming: [],
      ranges: [
        {
          sku_range: 'Pants',
          anchor_pct: 20,
          mechanic_label: '20% Off',
          source: 'recommended',
          upcoming: [{ effective_from: '2027-06-01', anchor_pct: 15, mechanic_label: '15% Off', source: 'projected' }],
        },
      ],
    },
  ],
};

test('every customer and each of its SKU ranges is a target', () => {
  const targets = anchorTargets(ANCHORS);

  assert.deepEqual(targets.map((target) => [target.customerName, target.skuRange]), [['FairPrice', null], ['FairPrice', 'Pants']]);
  assert.deepEqual(anchorTargets(null), []);
});

test('a month takes the latest change that has started by then', () => {
  const pants = anchorTargets(ANCHORS)[1].entry;

  assert.equal(anchorInMonth(pants, '2027-05-01').mechanic_label, '20% Off');
  assert.equal(anchorInMonth(pants, '2027-06-01').mechanic_label, '15% Off');
  assert.equal(anchorInMonth(pants, '2027-06-01').source, 'projected');
});
