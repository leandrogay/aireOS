// The steps a value goes through, as the review screen words and previews
// them (backend mapping_contract.TRANSFORM_TYPES, run by apply_contract).
// Run with `npm test` -- Node's built-in test runner, no extra packages.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { STEP_TYPES, newStep, runSamples, stepLabel, stepProblem } from '../app/utils/transformSteps.js';

// backend mapping_contract.TRANSFORM_TYPES
const BACKEND_TYPES = [
  'regex_extract', 'split_part', 'replace', 'normalize_text', 'concat',
  'value_map', 'rules',
  'blank_if', 'fill_empty', 'forward_fill', 'zero_as_empty',
  'parse_number', 'negate', 'scale', 'uom_factor', 'multiply', 'divide', 'add', 'subtract',
  'parse_date', 'month_start',
];

describe('the vocabulary', () => {
  test('every step the transformation runs can be added and is named', () => {
    assert.deepEqual(STEP_TYPES.map((step) => step.type).sort(), [...BACKEND_TYPES].sort());
    for (const type of BACKEND_TYPES) assert.notEqual(stepLabel(type), type);
  });

  test('a step added later still shows by its stored name', () => {
    assert.equal(stepLabel('something_new'), 'something_new');
  });
});

describe('stepProblem', () => {
  test('a new step that needs a setting says so until it is given', () => {
    for (const type of ['divide', 'add', 'subtract', 'concat', 'replace', 'fill_empty']) {
      assert.notEqual(stepProblem(newStep(type)), '', type);
    }
    assert.equal(stepProblem({ type: 'divide', column: 'Pack' }, ['Pack']), '');
    assert.equal(stepProblem({ type: 'concat', columns: ['Size'], separator: '|' }, ['Size']), '');
    assert.equal(stepProblem({ type: 'fill_empty', column: 'Branch' }, ['Branch']), '');
  });

  test('steps that work as first added have no problem', () => {
    for (const type of ['parse_number', 'parse_date', 'scale', 'blank_if', 'split_part', 'normalize_text']) {
      assert.equal(stepProblem(newStep(type)), '', type);
    }
  });

  test('a scale of 0, a part number of 0 and a format without % codes are caught', () => {
    assert.notEqual(stepProblem({ type: 'scale', factor: 0 }), '');
    assert.notEqual(stepProblem({ type: 'split_part', separator: '-', index: 0 }), '');
    assert.notEqual(stepProblem({ type: 'parse_date', format: 'dd/mm/yyyy' }), '');
    assert.equal(stepProblem({ type: 'month_start', format: 'excel_serial' }), '');
  });
});

describe('runSamples', () => {
  const after = (value, ...steps) => runSamples([value], steps)[0].after;

  test('one part of a split value', () => {
    assert.equal(after('BB17 - BEDOK', { type: 'split_part', separator: '-', index: 1 }), 'BB17');
    assert.equal(after('BB17 - BEDOK', { type: 'split_part', separator: '-', index: -1 }), 'BEDOK');
    assert.equal(after('BB17', { type: 'split_part', separator: '-', index: 2 }), null);
  });

  test('placeholders become empty, whatever their capitals', () => {
    assert.equal(after('n/a', { type: 'blank_if', tokens: ['N/A', '-'] }), null);
    assert.equal(after('12', { type: 'blank_if', tokens: ['N/A', '-'] }), '12');
  });

  test('text is replaced and tidied in turn', () => {
    const steps = [{ type: 'replace', pattern: '\\^$', replacement: '' }, { type: 'normalize_text', case: 'upper' }];
    assert.equal(after(' aire   pants xl^', ...steps), 'AIRE PANTS XL');
  });

  test('a fixed factor converts a figure', () => {
    assert.equal(after('3', { type: 'scale', factor: 12 }), '36');
  });

  test('steps that need the whole row, or the real reader, are left to the test', () => {
    assert.match(runSamples(['$1,250.50'], [{ type: 'parse_number', decimal: '.' }])[0].note, /test/);
    assert.equal(runSamples(['12'], [{ type: 'divide', column: 'Pack' }])[0].after, '12');
  });
});
