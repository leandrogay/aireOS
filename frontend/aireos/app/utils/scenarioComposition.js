// ============================================================
// WHAT MAKES UP THE SIMULATED LINE -- pure, import-free (tests/scenarioComposition.test.mjs)
// ============================================================
//
// The Scenario builder shades the area under the Simulated line by what each
// month is made of, the same breakdown as the hover card and the Breakdown
// tab: Tier 0's ordinary-month baseline (at the anchor), the promotions
// Tier 0 carries from the months it is built from (what is left of them
// once a planned promotion replaces them), the official promotions planned
// on the Promotions page, then what growth, building blocks and scenario
// promotions add (scenarioTier0Split.js). With no split for a month the
// baseline is Tier 0 itself and nothing is carried.
//
// Areas only stack upwards, so what adds and what takes away are drawn
// apart: the additions stack on what is left of the baseline, and every
// part that takes units away is a hatched band above the Simulated line, up
// to where the line would be without it -- carried promotions that sold
// less than an ordinary month, official promotions below the anchor, and
// decreases from blocks or scenario promotions, each in its own colour.

// Bottom to top, as the chart stacks them.
export const COMPOSITION_KEYS = [
  'baselineLayer',
  'carriedLayer',
  'officialLayer',
  'growthLayer',
  'blocksLayer',
  'promotionsLayer',
  'carriedDownLayer',
  'officialDownLayer',
  'growthDownLayer',
  'blocksDownLayer',
  'promotionsDownLayer',
];

// The bands drawn above the line: what takes units away.
const DOWN_KEYS = ['carriedDownLayer', 'officialDownLayer', 'growthDownLayer', 'blocksDownLayer', 'promotionsDownLayer'];

const PART_LAYERS = {
  baseline: ['baselineLayer'], carried: ['carriedLayer', 'carriedDownLayer'],
  official: ['officialLayer', 'officialDownLayer'], growth: ['growthLayer', 'growthDownLayer'],
  blocks: ['blocksLayer', 'blocksDownLayer'], promotions: ['promotionsLayer', 'promotionsDownLayer'],
};

/** Keep stack geometry intact while identifying a sidebar part's positive and negative bands. */
export function isSpotlightLayer(key, spotlight) {
  return !spotlight || Boolean(PART_LAYERS[spotlight]?.includes(key));
}

/** Spotlight changes paint only; all bands stay mounted at their original stack positions. */
export function compositionOpacity(layer, spotlight) {
  if (!spotlight) return layer.hatch ? 1 : (layer.opacity ?? 0.3);
  return isSpotlightLayer(layer.key, spotlight) ? (layer.hatch ? 1 : 0.7) : 0.025;
}

// A band's number shows only when it is at least this tall on screen, so
// labels never overlap or spill out of a thin band.
export const MIN_LABEL_PX = 12;
// ...and only when months are at least this far apart.
export const MIN_LABEL_SLOT_PX = 34;

// One colour per part of the Scenario builder's breakdown, shared by the
// chart's shaded bands, the Breakdown tab's lists, the milestone rings on the
// Actual line and the Planned pills, so they always match. Each pair passes
// the data-viz palette validator; next to the forecast lines some sit close
// in hue (growth / Current, scenario promotions / Initial, blocks /
// Simulated), but those are faint labelled fills, not lines.
export const PART_COLORS = {
  // Cyan, a hue no line or overlay uses, so the baseline isn't read as the Actual line.
  baseline: '#38B2CC',
  // Deep violet, well apart from the Actual line's navy (#3A4369).
  carried: '#5B21B6',
  official: '#2A78D6',
  growth: '#3F8F3A',
  blocks: '#E87BA4',
  promotions: '#C9A227',
  milestones: '#7A4A12',
  // What takes units away, hatched above the Simulated line.
  decrease: '#D23F74',
};

/**
 * One chart point with its layers and breakdown added. `items` are the
 * month's per-item totals ({ source, deltaUnits, addedUnits, replacedUnits },
 * scenarioEngine cellsByMonth); `split` the month's Tier 0 split totals
 * (scenarioTier0Split.monthSplit: baseline, carried), or null. The
 * Simulated value is the point's own (withSimulatedLine, floored at 0), so
 * the layers always meet the line.
 *
 * Adds a value per COMPOSITION_KEYS key and `breakdown`: { tier0, baseline,
 * carried (what is left of the carried promotions; 0 when they are switched
 * off), carriedTotal, replaced, officialAdded / promotionsAdded (what they
 * add on the baseline), official, growth, blocks, promotions
 * (each source's net change on Tier 0), simulated }. Baseline + carried +
 * officialAdded + growth + blocks + promotionsAdded = Simulated (before the
 * 0 floor).
 *
 * @param {object} point withSimulatedLine output (or a point with no Simulated)
 * @param {{ source: string, deltaUnits: number, addedUnits?: number, replacedUnits?: number }[]} items
 * @param {{ baseline: number, carried: number } | null} [split]
 */
export function withComposition(point, items, split = null) {
  const tier0 = point.current;
  if (tier0 == null) return point;

  const baseline = split ? split.baseline : tier0;
  const carriedTotal = split ? split.carried : 0;
  // Each source's net change on Tier 0.
  const net = { official: 0, growth: 0, blocks: 0, promotions: 0 };
  let replaced = 0;
  let officialAdded = 0;
  let promotionsAdded = 0;
  const up = { growthLayer: 0, blocksLayer: 0, promotionsLayer: 0 };
  const down = { growthDownLayer: 0, blocksDownLayer: 0, promotionsDownLayer: 0 };
  let decrease = 0;
  for (const item of items) {
    if (!(item.source in net)) continue;
    net[item.source] += item.deltaUnits;
    replaced += item.replacedUnits ?? 0;
    const added = item.addedUnits ?? item.deltaUnits;
    if (item.source === 'promotions') promotionsAdded += added;
    if (item.source === 'official') {
      officialAdded += added;
    } else if (added > 0) {
      up[`${item.source}Layer`] += added;
    } else {
      decrease -= added;
      down[`${item.source}DownLayer`] -= added;
    }
  }

  const carried = carriedTotal - replaced;
  const layers = {
    carriedLayer: Math.max(0, carried),
    officialLayer: Math.max(0, officialAdded),
    ...up,
    carriedDownLayer: Math.max(0, -carried),
    officialDownLayer: Math.max(0, -officialAdded),
    decreaseLayer: decrease,
    ...down,
  };
  const simulated = point.simulated ?? tier0;
  const added = layers.carriedLayer + layers.officialLayer + up.growthLayer + up.blocksLayer + up.promotionsLayer;

  return {
    ...point,
    baselineLayer: Math.max(0, simulated - added),
    ...layers,
    breakdown: { tier0, baseline, carried, carriedTotal, replaced, officialAdded, promotionsAdded, ...net, simulated },
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
 * The Breakdown tab's contribution list: each month's breakdown on the chart
 * (withComposition) added up -- what the forecast already holds (baseline,
 * last year's promotions, official promotions) and what the scenario adds
 * (growth, building blocks, scenario promotions), adding up to Simulated
 * before the 0 floor. `months` are the months it covers, in order.
 *
 * @param {Map<string, object>} breakdowns month_year → breakdown
 */
export function breakdownTotals(breakdowns) {
  const totals = { months: [...breakdowns.keys()].sort(), baseline: 0, carried: 0, official: 0, growth: 0, blocks: 0, promotions: 0, simulated: 0 };
  for (const breakdown of breakdowns.values()) {
    totals.baseline += breakdown.baseline;
    totals.carried += breakdown.carried;
    totals.official += breakdown.officialAdded ?? 0;
    totals.growth += breakdown.growth;
    totals.blocks += breakdown.blocks;
    totals.promotions += breakdown.promotionsAdded ?? breakdown.promotions;
    totals.simulated += breakdown.simulated;
  }
  return totals;
}

/**
 * The bands of one point to label, bottom to top, among the visible layers:
 * { key, low, high, text } in units. The baseline is named only when
 * nothing is taken away (otherwise its band is the baseline less what is
 * taken away, and the Breakdown tab has both). The Simulated total sits on top separately (totalLabel).
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
      if (key === 'baselineLayer') text = DOWN_KEYS.some((down) => point[down]) ? null : compactUnits(point.breakdown.baseline);
      else if (DOWN_KEYS.includes(key)) text = signed(-size);
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
