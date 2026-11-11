// ============================================================
// WHAT MAKES UP THE SIMULATED LINE -- pure, import-free (tests/scenarioComposition.test.mjs)
// ============================================================
//
// The Scenario builder shades the area under the Simulated line by what each
// month is made of, the same breakdown as the hover card: Tier 0, then what
// growth, building blocks and scenario promotions add. Tier 0 still includes
// the promotions of the history it is built from; splitting it into the
// ordinary-month baseline and those promotions needs the forecast run's two
// halves (bigquery/schemas/tier0_component_contract.md), so it waits for that.
//
// Areas only stack upwards, so increases and decreases are drawn apart: the
// increases stack on what is left of Tier 0, and the units taken away are a
// hatched band above the Simulated line, up to where the line would be
// without them. With only decreases that band runs from the Simulated line
// up to the Tier 0 line.

// Bottom to top, as the chart stacks them.
export const COMPOSITION_KEYS = ['tier0Layer', 'growthLayer', 'blocksLayer', 'promotionsLayer', 'decreaseLayer'];

const SOURCE_LAYERS = { growth: 'growthLayer', blocks: 'blocksLayer', promotions: 'promotionsLayer' };

// A band's number shows only when it is at least this tall on screen, so
// labels never overlap or spill out of a thin band.
export const MIN_LABEL_PX = 12;
// ...and only when months are at least this far apart.
export const MIN_LABEL_SLOT_PX = 34;

/**
 * One chart point with its layers and breakdown added. `items` are the
 * month's per-item totals ({ source, deltaUnits }, scenarioEngine
 * cellsByMonth); the Simulated value is the point's own (withSimulatedLine,
 * floored at 0), so the layers always meet the line.
 *
 * Adds `tier0Layer` (Tier 0 less any decrease), `growthLayer` /
 * `blocksLayer` / `promotionsLayer` (what each adds; increases only),
 * `decreaseLayer` (units taken away) and `breakdown`: { tier0, growth,
 * blocks, promotions, simulated } with each source's net change.
 *
 * @param {object} point withSimulatedLine output (or a point with no Simulated)
 * @param {{ source: string, deltaUnits: number }[]} items
 */
export function withComposition(point, items) {
  const tier0 = point.current;
  if (tier0 == null) return point;

  const increases = { growthLayer: 0, blocksLayer: 0, promotionsLayer: 0 };
  const net = { growth: 0, blocks: 0, promotions: 0 };
  for (const item of items) {
    const layer = SOURCE_LAYERS[item.source];
    if (!layer) continue;
    net[item.source] += item.deltaUnits;
    if (item.deltaUnits > 0) increases[layer] += item.deltaUnits;
  }
  const added = increases.growthLayer + increases.blocksLayer + increases.promotionsLayer;
  const simulated = point.simulated ?? tier0;
  const base = Math.max(0, simulated - added);

  return {
    ...point,
    tier0Layer: base,
    ...increases,
    decreaseLayer: Math.max(0, tier0 - base),
    breakdown: { tier0, ...net, simulated },
  };
}

/**
 * A count for a tiny label: 980, 12.4k, 1.2M.
 *
 * @param {number} value
 */
export function compactUnits(value) {
  const size = Math.abs(value);
  if (size >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (size >= 1e4) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return Math.round(value).toLocaleString('en-US');
}

function signed(value) {
  return `${value < 0 ? '−' : '+'}${compactUnits(Math.abs(value))}`;
}

/**
 * The bands of one point to label, bottom to top, among the visible layers:
 * { key, low, high, text } in units. Tier 0 is named only when nothing is
 * taken away (otherwise its band is Tier 0 less the decrease, and the hover
 * card has both). The Simulated total sits on top separately (totalLabel).
 *
 * @param {object} point withComposition output
 * @param {Record<string, boolean>} visible compositionVisible
 */
export function bandLabels(point, visible) {
  if (!point.breakdown) return [];
  const labels = [];
  let low = 0;
  for (const key of COMPOSITION_KEYS) {
    if (!visible[key]) continue;
    const size = point[key] ?? 0;
    const high = low + size;
    if (size > 0) {
      let text = null;
      if (key === 'tier0Layer') text = point.decreaseLayer ? null : compactUnits(point.breakdown.tier0);
      else if (key === 'decreaseLayer') text = signed(-size);
      else text = signed(size);
      if (text) labels.push({ key, low, high, text });
    }
    low = high;
  }
  return labels;
}

/**
 * The Simulated total above the stack, at the top of whatever is drawn
 * (the hatched band reaches above the line): { value, text } in units, or
 * null with nothing simulated.
 *
 * @param {object} point withComposition output
 * @param {Record<string, boolean>} visible
 */
export function totalLabel(point, visible) {
  if (!point.breakdown || point.simulated == null) return null;
  const top = COMPOSITION_KEYS.filter((key) => visible[key]).reduce((sum, key) => sum + (point[key] ?? 0), 0);
  return { value: Math.max(top, point.simulated), text: compactUnits(point.breakdown.simulated) };
}
