// Picking one cell of the file for a field written on every row (backend
// mapping_contract from_cell). Run with `npm test` -- Node's built-in test
// runner, no extra packages.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cellGrid, cellGuess, cleanCellReference, columnLetters } from '../app/utils/sheetCells.js';

describe('cleanCellReference', () => {
  test('a reference is stored in capitals without dollar signs', () => {
    assert.equal(cleanCellReference(' a1 '), 'A1');
    assert.equal(cleanCellReference('$AB$12'), 'AB12');
  });

  test('anything that is not a cell is empty', () => {
    assert.equal(cleanCellReference('row 1'), '');
    assert.equal(cleanCellReference('A0'), '');
    assert.equal(cleanCellReference(null), '');
  });
});

describe('columnLetters', () => {
  test('columns are lettered as a spreadsheet letters them', () => {
    assert.deepEqual([1, 26, 27, 702, 703].map(columnLetters), ['A', 'Z', 'AA', 'ZZ', 'AAA']);
  });
});

describe('cellGrid', () => {
  test('the grid runs from A1 to the last cell kept, gaps left empty', () => {
    const grid = cellGrid({ A1: 'Jul-26', C1: 'TAMPINES', B3: '17' });

    assert.deepEqual(grid.columns, ['A', 'B', 'C']);
    assert.deepEqual(grid.rows.map((item) => item.row), [1, 2, 3]);
    assert.deepEqual(grid.rows[0].cells, { A: 'Jul-26', B: '', C: 'TAMPINES' });
    assert.equal(grid.rows[2].cells.B, '17');
  });

  test('a layout read before cells were kept has no grid', () => {
    assert.deepEqual(cellGrid(undefined), { columns: [], rows: [] });
  });
});

describe('cellGuess', () => {
  const layout = {
    cells: { A1: 'Jul-26', B1: 'YISHUN' },
    stated_period: { start: '2026-07-01', end: '2026-07-31', stated_in: 'Jul-26', source: 'heading' },
  };

  test('the period starts on the cell holding the month heading', () => {
    assert.equal(cellGuess(layout, 'period_start'), 'A1');
  });

  test('other fields start with no cell chosen', () => {
    assert.equal(cellGuess(layout, 'store_name'), '');
    assert.equal(cellGuess({ cells: layout.cells }, 'period_start'), '');
  });
});
