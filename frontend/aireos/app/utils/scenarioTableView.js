const YEAR_PARTS = [
  { key: 'official', label: 'Official promotions' },
  { key: 'carried', label: "Last year's promotions left out" },
  { key: 'growth', label: 'Growth' },
  { key: 'blocks', label: 'Building blocks' },
  { key: 'promotions', label: 'Scenario promotions' },
];

/** Individual changes stay visible even when increases and decreases cancel out. */
export function yearContributions(parts = {}) {
  return YEAR_PARTS.filter((part) => Math.round(parts[part.key] ?? 0))
    .map((part) => ({ ...part, units: parts[part.key] }));
}

/** Detailed monthly contributions; the collapsed row only needs their net change. */
export function monthlyContributions(row, { split = false, baseLabel = 'Current' } = {}) {
  const result = [{ key: 'base', label: split ? 'Baseline' : baseLabel,
    units: split ? row.parts?.baseline ?? row.model.units : row.model.units, level: true }];
  if (split) {
    for (const line of row.promotionLines) {
      result.push({ key: line.kind, label: line.kind === 'official' ? 'Official promotions' : "Last year's promotions",
        units: line.units, line });
    }
  }
  if (row.parts) {
    for (const key of ['growth', 'blocks', 'promotions']) {
      const items = row.items.filter((item) => item.source === key);
      if (Math.round(row.parts[key] ?? 0) || items.length) {
        result.push({ key, label: YEAR_PARTS.find((part) => part.key === key).label, units: row.parts[key] ?? 0, items });
      }
    }
  } else if (Math.round(row.blocks.units) || row.items.length) {
    result.push({ key: 'adjustments', label: 'Adjustments', units: row.blocks.units, items: row.items });
  }
  return result;
}
