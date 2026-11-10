// The review screen's product-code table helpers (backend mapping_checks.sku_codes).
// Run with `npm test` -- Node's built-in test runner, no extra packages.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { skuSourceKey } from '../app/utils/skuCodeTable.js';

describe('skuSourceKey', () => {
  test('names the column the sku is read from', () => {
    const rows = [
      { column: 'Article', fields: [{ targetField: 'sku' }] },
      { column: 'Qty', fields: [{ targetField: 'quantity_units' }] },
    ];

    assert.equal(skuSourceKey(rows, []), 'column:Article');
  });

  test('a different column is a different source', () => {
    const before = skuSourceKey([{ column: 'Article', fields: [{ targetField: 'sku' }] }], []);
    const after = skuSourceKey([{ column: 'Barcode', fields: [{ targetField: 'sku' }] }], []);

    assert.notEqual(before, after);
  });

  test('null while nothing fills the sku', () => {
    assert.equal(skuSourceKey([{ column: 'Qty', fields: [{ targetField: 'quantity_units' }] }], []), null);
  });

  test('a column group that carries the sku in its headings is a source too', () => {
    assert.match(skuSourceKey([], [{ field: 'sku', columns: ['A1', 'A2'] }]), /^group:/);
  });
});
