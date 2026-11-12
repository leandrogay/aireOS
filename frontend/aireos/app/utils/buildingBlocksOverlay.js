// The sell-in plan chart's building blocks overlay (inventory
// BuildingBlocksOverlay): which saved Scenario builder blocks it offers, and
// which picked ones change nothing on the chart. The blocks are applied by
// the backend (get_sell_in_outlook's block_ids), the same way as the
// Scenario builder's Simulated line.

/**
 * The saved blocks that cover one customer (they name it, or cover every
 * customer), by name: the ones the overlay offers. Blocks are in
 * scenarioBlockFromApi's shape (customers = customer_names, [] = every
 * customer); the backend picks the same ones (fetch_blocks_for_customer).
 *
 * @param {object[]} blocks
 * @param {string | undefined} customerName
 * @returns {object[]}
 */
export function customerBlocks(blocks, customerName) {
  return blocks
    .filter(
      (block) => block.blockId != null && (!block.customers?.length || block.customers.includes(customerName))
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.blockId - b.blockId);
}

/**
 * The picked block ids still on offer, so a pick of another customer's block
 * (or one deleted since) is dropped rather than sent.
 *
 * @param {number[]} blockIds
 * @param {object[]} offered customerBlocks()
 * @returns {number[]}
 */
export function pickedBlockIds(blockIds, offered) {
  const ids = new Set(offered.map((block) => block.blockId));
  return blockIds.filter((id) => ids.has(id));
}

/**
 * The names of picked blocks that add nothing to the chart's sell-out (their
 * SKU is filtered out, or their months have no Current forecast), from
 * get_sell_in_outlook's `building_blocks`.
 *
 * @param {Array<{ name: string, sell_out_change: number }>} applied
 * @returns {string[]}
 */
export function blocksWithoutEffect(applied) {
  return applied.filter((block) => Math.abs(block.sell_out_change) < 0.5).map((block) => block.name);
}
