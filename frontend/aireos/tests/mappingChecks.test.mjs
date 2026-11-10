// How the review screen lists a mapping's checks (backend mapping_checks).
// Run with `npm test` -- Node's built-in test runner, no extra packages.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { groupRequiredChecks } from '../app/utils/mappingChecks.js';

function required(field, passed = false) {
  return { id: `required_${field}`, level: 'error', passed, message: `${field} is required`, fields: [field], evidence: {} };
}

const LABELS = { sku: 'Product code (SKU)', quantity_units: 'Units sold' };
const labelOf = (field) => LABELS[field] || field;

describe('groupRequiredChecks', () => {
  test('several missing required fields become one line naming them all', () => {
    const totals = { id: 'totals', level: 'warning', passed: false, message: 'totals', fields: [], evidence: {} };

    const grouped = groupRequiredChecks([required('sku'), totals, required('quantity_units')], labelOf);

    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].id, 'required_fields');
    assert.equal(grouped[0].message, '2 required fields have no source yet: Product code (SKU), Units sold.');
    assert.deepEqual(grouped[0].fields, ['sku', 'quantity_units']);
    assert.equal(grouped[1], totals);
  });

  test('one missing field keeps its own message', () => {
    const checks = [required('sku'), required('quantity_units', true)];

    assert.deepEqual(groupRequiredChecks(checks, labelOf), checks);
  });

  test('passed required checks are never folded', () => {
    const checks = [required('sku', true), required('quantity_units', true)];

    assert.deepEqual(groupRequiredChecks(checks, labelOf), checks);
  });
});
