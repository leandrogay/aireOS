import test from 'node:test';
import assert from 'node:assert/strict';

import { monthlyContributions, yearContributions } from '../app/utils/scenarioTableView.js';

test('monthly details preserve the split and every contribution while the summary uses the net change', () => {
  const row = {
    model: { units: 100 }, adjusted: { units: 120 }, blocks: { units: 20 },
    parts: { baseline: 80, growth: 10, blocks: -5, promotions: 20 },
    promotionLines: [{ kind: 'carried', units: 10, groups: [] }, { kind: 'official', units: 5, groups: [] }],
    items: [{ itemId: 'b1', name: 'Flood', state: 'saved', source: 'blocks' }],
  };
  const parts = monthlyContributions(row, { split: true });
  assert.equal(parts.reduce((total, part) => total + part.units, 0), row.adjusted.units);
  assert.equal(row.adjusted.units - row.model.units, 20);
  assert.equal(parts.find((part) => part.key === 'blocks').items[0].name, 'Flood');
  assert.equal(parts.find((part) => part.key === 'official').line, row.promotionLines[1]);
});

test('a zero-unit draft retains its name and state in expanded details', () => {
  const row = { model: { units: 0 }, blocks: { units: 0 }, parts: { blocks: 0 }, promotionLines: [],
    items: [{ itemId: 'draft', source: 'blocks', state: 'draft', name: 'New outlets' }] };
  const parts = monthlyContributions(row, { baseLabel: 'Initial base' });
  assert.equal(parts[0].label, 'Initial base');
  assert.equal(parts[1].units, 0);
  assert.equal(parts[1].items[0].state, 'draft');
});

test('year details retain opposite contributions even when the annual net change is zero', () => {
  const parts = yearContributions({ growth: 100, blocks: -100, promotions: 0 });
  assert.deepEqual(parts.map((part) => part.units), [100, -100]);
  assert.equal(parts.reduce((total, part) => total + part.units, 0), 0);
});

test('a monthly row without a split keeps the original base and net adjustment', () => {
  const row = { model: { units: 50 }, blocks: { units: -10 }, parts: null, promotionLines: [], items: [] };
  assert.deepEqual(monthlyContributions(row).map((part) => [part.label, part.units]), [['Current', 50], ['Adjustments', -10]]);
});
