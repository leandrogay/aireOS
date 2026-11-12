import { matchesSearch } from './tableView.js';

/** Saved records remain visible independently of chart scope or their active switch. */
export function savedScenarioItems(items, search = '') {
  return items.filter((item) => item.saved && matchesSearch([
    item.name, item.mechanicLabel, item.explanation, item.sku,
    ...(item.customers ?? []), ...(item.skuRanges ?? []),
  ], search));
}

/** Refresh saved records without losing drafts, unsaved edits or stable editor/row IDs. */
export function mergeScenarioItems(current, incoming, serverId, hasChanges) {
  const existing = new Map(current.filter((item) => item[serverId] != null).map((item) => [item[serverId], item]));
  const received = new Set(incoming.map((item) => item[serverId]));
  const merged = incoming.map((item) => {
    const before = existing.get(item[serverId]);
    if (before && hasChanges(before)) return before;
    return before ? { ...item, id: before.id } : item;
  });
  return [...merged, ...current.filter((item) => !received.has(item[serverId]) && hasChanges(item))];
}
