// Y-axis tick labels for the dashboard charts (see metricYAxisProps in
// trendChart.js). Pure and import-free so `npm test` (node --test) can
// check it without a browser.
//
// Every tick on one axis uses the same unit and the same number of decimals,
// chosen from the axis top: an axis that reaches $3.2k reads
// $0, $0.8k, $1.6k, $2.4k, $3.2k -- never "$800.00" beside "$1.6k".

const UNITS = [
  { size: 1e6, suffix: 'M' },
  { size: 1e3, suffix: 'k' },
];

// The fewest decimals (0-2) that show `step` exactly, so 0.8k steps get one
// decimal and 5k steps none. Float noise (0.1 + 0.2) is ignored.
function decimalsFor(step) {
  for (let decimals = 0; decimals < 2; decimals += 1) {
    const scaled = step * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return decimals;
  }
  return 2;
}

/**
 * A tick formatter for an axis running from 0 to `axisMax` in `steps` equal
 * steps. Values are shown in k (thousands) or M (millions) when the axis top
 * reaches them, with `prefix` in front ('$' for revenue, '' for units). Zero
 * is always a bare "$0" / "0", and a negative value puts its sign first
 * ("-$0.8k"). `axisMax` is the furthest the axis reaches from 0, on either side.
 *
 * @param {number} axisMax
 * @param {number} steps
 * @param {string} [prefix]
 * @returns {(value: number) => string}
 */
export function axisTickFormatter(axisMax, steps, prefix = '') {
  const unit = UNITS.find(({ size }) => axisMax >= size) ?? { size: 1, suffix: '' };
  const decimals = decimalsFor(axisMax / steps / unit.size);
  function format(value) {
    if (typeof value !== 'number') return value;
    if (value === 0) return `${prefix}0`;
    // A negative tick (returns) reads -$0.8k, not $-0.8k.
    if (value < 0) return `-${format(-value)}`;
    const shown = (value / unit.size).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `${prefix}${shown}${unit.suffix}`;
  }
  return format;
}
