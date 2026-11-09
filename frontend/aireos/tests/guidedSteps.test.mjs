// The guided nomenclature review's screens. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  canContinue,
  guidedSteps,
  nextStep,
  previousStep,
  skippedSteps,
  stepForCheck,
  stepForItem,
} from '../app/utils/guidedSteps.js';

// A known, clean monthly file: nothing optional to ask.
const CLEAN = {
  hasCustomer: true,
  retailersDone: true,
  groupCount: 0,
  unconfirmedGroups: 0,
  unconfirmedFields: 0,
  duplicateCount: 0,
  missingCount: 0,
  rollupRelevant: false,
  codeCount: 12,
  unknownCodeCount: 0,
  masterAvailable: true,
  checksFailed: 0,
  checksStale: false,
};

describe('guidedSteps', () => {
  test('a clean file only gets the screens every mapping needs', () => {
    assert.deepEqual(guidedSteps(CLEAN), ['intro', 'customer', 'channel', 'fields', 'test', 'approve']);
    assert.deepEqual(skippedSteps(CLEAN), ['groups', 'missing', 'rollup', 'products']);
  });

  test('a messy file gets every optional screen in order', () => {
    const status = { ...CLEAN, groupCount: 1, missingCount: 2, rollupRelevant: true, unknownCodeCount: 3 };
    assert.deepEqual(guidedSteps(status), [
      'intro',
      'customer',
      'channel',
      'groups',
      'fields',
      'missing',
      'rollup',
      'products',
      'test',
      'approve',
    ]);
  });

  test('a visited screen stays after its problem is fixed', () => {
    assert.ok(guidedSteps(CLEAN, ['missing']).includes('missing'));
  });

  test('product codes are asked when the SKU master could not be read', () => {
    assert.ok(guidedSteps({ ...CLEAN, masterAvailable: false }).includes('products'));
    assert.ok(!guidedSteps({ ...CLEAN, codeCount: 0, masterAvailable: false }).includes('products'));
  });
});

describe('canContinue', () => {
  test('waits on the answer each screen asks for', () => {
    assert.equal(canContinue('customer', { ...CLEAN, hasCustomer: false }), false);
    assert.equal(canContinue('channel', { ...CLEAN, retailerUnconfirmed: true }), false);
    assert.equal(canContinue('fields', { ...CLEAN, unconfirmedFields: 1 }), false);
    assert.equal(canContinue('fields', { ...CLEAN, duplicateCount: 1 }), false);
    assert.equal(canContinue('missing', { ...CLEAN, missingCount: 1 }), false);
    assert.equal(canContinue('products', { ...CLEAN, unknownCodeCount: 1 }), false);
    assert.equal(canContinue('intro', CLEAN), true);
  });

  test('the test screen needs a passing run of the current edits', () => {
    assert.equal(canContinue('test', CLEAN), true);
    assert.equal(canContinue('test', { ...CLEAN, checksFailed: 1 }), false);
    assert.equal(canContinue('test', { ...CLEAN, checksStale: true }), false);
  });
});

describe('moving between screens', () => {
  const steps = ['intro', 'customer', 'channel'];

  test('next and previous stop at the ends', () => {
    assert.equal(nextStep('intro', steps), 'customer');
    assert.equal(nextStep('channel', steps), null);
    assert.equal(previousStep('customer', steps), 'intro');
    assert.equal(previousStep('intro', steps), null);
  });

  test('a checklist item points at the screen that settles it', () => {
    const all = ['intro', 'customer', 'channel', 'fields', 'missing', 'products', 'test', 'approve'];
    assert.equal(stepForItem('retailers', all), 'channel');
    assert.equal(stepForItem('required', all), 'missing');
    assert.equal(stepForItem('required', ['fields']), 'fields');
    assert.equal(stepForItem('products', ['fields', 'approve']), 'approve');
  });

  test('a failing check points at the screen that fixes it', () => {
    const all = ['fields', 'missing', 'products'];
    assert.equal(stepForCheck({ fields: ['sku'] }, all), 'products');
    assert.equal(stepForCheck({ fields: ['revenue'] }, all, ['revenue']), 'missing');
    assert.equal(stepForCheck({ fields: ['revenue'] }, all), 'fields');
    assert.equal(stepForCheck({}, all), 'fields');
  });
});
