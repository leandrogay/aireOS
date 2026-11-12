// The sell-in plan chart's building blocks overlay. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { blocksWithoutEffect, customerBlocks, pickedBlockIds } from '../app/utils/buildingBlocksOverlay.js';

function block(blockId, name, customers = ['fairprice']) {
  return { blockId, name, customers };
}

describe('customerBlocks', () => {
  test('offers only the saved blocks of the chosen customer, by name', () => {
    const blocks = [block(2, 'Store closing'), block(1, 'New store'), block(3, 'Other', ['nhg']), { ...block(null, 'Draft') }];

    assert.deepEqual(customerBlocks(blocks, 'fairprice').map((b) => b.name), ['New store', 'Store closing']);
  });

  test('offers blocks naming several customers, or every customer, to each of them', () => {
    const blocks = [block(1, 'Both', ['fairprice', 'nhg']), block(2, 'Everyone', []), block(3, 'Other', ['prime'])];

    assert.deepEqual(customerBlocks(blocks, 'nhg').map((b) => b.name), ['Both', 'Everyone']);
  });
});

describe('pickedBlockIds', () => {
  test('drops picks that are no longer on offer', () => {
    assert.deepEqual(pickedBlockIds([1, 3, 9], [block(1, 'A'), block(3, 'B')]), [1, 3]);
  });
});

describe('blocksWithoutEffect', () => {
  test('names the blocks that change nothing on the chart', () => {
    const applied = [
      { block_id: 1, name: 'New store', sell_out_change: 120 },
      { block_id: 2, name: 'Flood', sell_out_change: -40 },
      { block_id: 3, name: 'Other SKU', sell_out_change: 0 },
    ];

    assert.deepEqual(blocksWithoutEffect(applied), ['Other SKU']);
  });
});
