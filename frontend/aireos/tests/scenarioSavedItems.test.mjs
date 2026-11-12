import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeScenarioItems, savedScenarioItems } from '../app/utils/scenarioSavedItems.js';

const records = Array.from({ length: 7 }, (_, index) => ({
  id: `block-${index}`, blockId: index, name: `Block ${index}`, saved: { isActive: index < 3 },
  isActive: index < 3, customers: index < 3 ? ['FairPrice'] : ['NHG'], skuRanges: ['Pants'],
  startMonth: index < 3 ? '2027-01-01' : '2026-01-01', endMonth: '2027-12-01', explanation: '',
}));
const changed = (item) => !item.saved || Boolean(item.edited);

test('all seven saved blocks are listed including inactive blocks and blocks outside the chart customer or dates', () => {
  const listed = savedScenarioItems([...records, { id: 'draft', name: 'Draft block', saved: null }]);
  assert.equal(listed.length, 7);
  assert.equal(listed.filter((item) => item.isActive).length, 3);
  assert.ok(listed.some((item) => item.customers.includes('NHG') && item.startMonth === '2026-01-01'));
});

test('only local search narrows a saved list and clearing it restores all records', () => {
  assert.equal(savedScenarioItems(records, 'nhg').length, 4);
  assert.equal(savedScenarioItems(records, 'pants').length, 7);
  assert.equal(savedScenarioItems(records, 'block 6')[0].blockId, 6);
  assert.equal(savedScenarioItems(records, '').length, 7);
});

test('saved promotions follow the same list rule and can be searched by mechanic or explanation', () => {
  const promotions = [{ id: 'p1', promotionId: 1, mechanicLabel: '50% Off', explanation: 'Anniversary sale', saved: {}, isActive: false }];
  assert.equal(savedScenarioItems(promotions).length, 1);
  assert.equal(savedScenarioItems(promotions, '50%').length, 1);
  assert.equal(savedScenarioItems(promotions, 'anniversary').length, 1);
});

test('refresh preserves a draft and unsaved edits while updating clean records without changing editor IDs', () => {
  const current = [{ id: 'local-1', blockId: 1, saved: {}, name: 'Old' },
    { id: 'local-2', blockId: 2, saved: {}, edited: true, name: 'Working edit' }, { id: 'draft', blockId: null, saved: null }];
  const incoming = [{ id: 'saved-1', blockId: 1, saved: {}, name: 'Fresh' }, { id: 'saved-2', blockId: 2, saved: {}, name: 'Server' }];
  const merged = mergeScenarioItems(current, incoming, 'blockId', changed);
  assert.deepEqual(merged.map((item) => [item.id, item.name]), [['local-1', 'Fresh'], ['local-2', 'Working edit'], ['draft', undefined]]);
  assert.equal(current[0].name, 'Old');
});

test('refresh drops deleted clean records but preserves a working edit if its server record was deleted', () => {
  const current = [{ id: 'deleted-clean', promotionId: 1, saved: {} }, { id: 'deleted-edited', promotionId: 2, saved: {}, edited: true }];
  assert.deepEqual(mergeScenarioItems(current, [], 'promotionId', changed).map((item) => item.id), ['deleted-edited']);
});
