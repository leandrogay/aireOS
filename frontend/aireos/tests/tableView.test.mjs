// Block paging for a list the backend pages (Recent uploads): which block to
// ask for, and which page of the loaded block is on screen.
// Run with `npm test` -- Node's built-in test runner, no extra packages.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { blockQuery, pageFromBlock } from '../app/utils/tableView.js';

const rows = (from, count) => Array.from({ length: count }, (_, index) => from + index);

// ---- blockQuery ----

describe('blockQuery', () => {
  test('pages inside the first block ask for the first block', () => {
    assert.deepEqual(blockQuery(1, 25, 100), { offset: 0, limit: 100 });
    assert.deepEqual(blockQuery(4, 25, 100), { offset: 0, limit: 100 });
  });

  test('the first page past a block asks for the next one', () => {
    assert.deepEqual(blockQuery(5, 25, 100), { offset: 100, limit: 100 });
    assert.deepEqual(blockQuery(11, 10, 100), { offset: 100, limit: 100 });
  });
});

// ---- pageFromBlock ----

describe('pageFromBlock', () => {
  test('slices the page out of the block it is in', () => {
    const block = { rows: rows(100, 100), offset: 100, total: 230 };

    const { pageRows, currentPage, totalPages } = pageFromBlock(block, 6, 25);

    assert.deepEqual(pageRows, rows(125, 25));
    assert.equal(currentPage, 6);
    assert.equal(totalPages, 10);
  });

  test('a page past the end shows the last page', () => {
    const block = { rows: rows(0, 30), offset: 0, total: 30 };

    const { pageRows, currentPage } = pageFromBlock(block, 9, 25);

    assert.deepEqual(pageRows, rows(25, 5));
    assert.equal(currentPage, 2);
  });

  test('while the next block loads, the last page of the loaded one stays', () => {
    const block = { rows: rows(0, 100), offset: 0, total: 230 };

    const { pageRows, currentPage } = pageFromBlock(block, 5, 25);

    assert.deepEqual(pageRows, rows(75, 25));
    assert.equal(currentPage, 4);
  });

  test('while an earlier block loads, the first page of the loaded one stays', () => {
    const block = { rows: rows(100, 100), offset: 100, total: 230 };

    assert.equal(pageFromBlock(block, 2, 25).currentPage, 5);
  });

  test('an empty list is one empty page', () => {
    assert.deepEqual(pageFromBlock({ rows: [], offset: 0, total: 0 }, 3, 25), {
      pageRows: [],
      currentPage: 1,
      totalPages: 1,
    });
  });

  test('nothing loaded yet is an empty page at the page asked for', () => {
    assert.deepEqual(pageFromBlock(null, 2, 25), { pageRows: [], currentPage: 2, totalPages: 1 });
  });
});
