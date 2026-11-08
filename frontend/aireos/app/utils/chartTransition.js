// Pure helpers for hooks/useChartTransition: a chart's numbers as a
// snapshot, blending two snapshots, and putting a snapshot back onto rows.
// Import-free so `npm test` (node --test) can check it without a browser.
//
// A snapshot is { values, domain }: `values` maps each row's key to its
// numbers ({ [valueKey]: number | number[] | null }), `domain` is the y-axis
// [min, max].

/**
 * The numbers a chart draws, keyed by row, plus its y-axis range.
 *
 * @param {Array<object>} rows
 * @param {string} rowKey the field that names a row (a month, a period label)
 * @param {string[]} valueKeys the fields drawn as bars, lines or ranges
 * @param {[number, number]} domain
 */
export function chartSnapshot(rows, rowKey, valueKeys, domain) {
  const values = new Map();
  for (const row of rows) {
    const entry = {};
    for (const key of valueKeys) entry[key] = row[key] ?? null;
    values.set(row[rowKey], entry);
  }
  return { values, domain };
}

// One number, or a [low, high] range, `t` of the way from `from` to `to`.
// Something new (no `from`) grows from 0; something gone (`to` null) is gone.
function blendValue(from, to, t) {
  if (to == null) return null;
  if (Array.isArray(to)) {
    const start = Array.isArray(from) && from.length === to.length ? from : to.map(() => 0);
    return to.map((value, i) => blendNumber(start[i], value, t));
  }
  return blendNumber(typeof from === 'number' ? from : 0, to, t);
}

function blendNumber(from, to, t) {
  if (typeof to !== 'number') return to;
  return from + (to - from) * t;
}

/**
 * The snapshot `t` (0 to 1) of the way from `from` to `to`. Rows and values
 * only in `to` grow from 0; rows only in `from` are dropped.
 *
 * @param {{ values: Map<any, object>, domain: [number, number] }} from
 * @param {{ values: Map<any, object>, domain: [number, number] }} to
 * @param {number} t
 */
export function blendSnapshots(from, to, t) {
  const values = new Map();
  for (const [rowId, target] of to.values) {
    const start = from.values.get(rowId) ?? {};
    const entry = {};
    for (const key of Object.keys(target)) entry[key] = blendValue(start[key], target[key], t);
    values.set(rowId, entry);
  }
  return {
    values,
    domain: [
      blendNumber(from.domain[0], to.domain[0], t),
      blendNumber(from.domain[1], to.domain[1], t),
    ],
  };
}

/**
 * `rows` with their numbers taken from `snapshot`; every other field (labels,
 * tooltip extras) stays as it is. A row the snapshot doesn't know keeps its
 * own numbers.
 *
 * @param {Array<object>} rows
 * @param {string} rowKey
 * @param {{ values: Map<any, object> }} snapshot
 */
export function withSnapshotValues(rows, rowKey, snapshot) {
  return rows.map((row) => {
    const values = snapshot.values.get(row[rowKey]);
    return values ? { ...row, ...values } : row;
  });
}

/**
 * The ticks that fall inside `domain` (with a little float slack): while the
 * axis is growing or shrinking, the new axis' ticks slide into place and the
 * ones still outside it wait off the plot.
 *
 * @param {number[] | undefined} ticks
 * @param {[number, number]} domain
 */
export function ticksWithin(ticks, domain) {
  if (!ticks) return ticks;
  const slack = Math.abs(domain[1] - domain[0]) * 1e-6;
  return ticks.filter((tick) => tick >= domain[0] - slack && tick <= domain[1] + slack);
}

/**
 * A short text that changes whenever anything the chart draws changes, so
 * the hook knows when to start a transition (rows are new arrays on every
 * render, so identity can't tell).
 *
 * @param {{ values: Map<any, object>, domain: [number, number] }} snapshot
 */
export function snapshotSignature(snapshot) {
  return JSON.stringify([snapshot.domain, [...snapshot.values]]);
}
