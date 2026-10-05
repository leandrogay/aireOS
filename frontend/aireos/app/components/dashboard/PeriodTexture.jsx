// "Past period" texture shared by the comparison chart, its legend and the
// Sell-out Summary: the comparison bar is a light tint of its colour with 45° stripes
// and an outline in a darker edge colour, while this period stays solid. The
// stripes and outline keep even the palest colours (UNITY's lavender,
// FINEST's light blue) legible on the white card, where fading alone made
// them vanish.

// The palest brand colours have almost no contrast with white, so edges are
// pulled 40% toward the deep blue — still recognisably the same hue.
export function edgeColor(color) {
  return `color-mix(in srgb, ${color} 60%, var(--aire-deep-blue))`;
}

// SVG pattern ids can't contain the characters React's useId produces.
export function patternId(baseId, key) {
  return `hatch-${baseId.replace(/[^a-zA-Z0-9_-]/g, '')}-${key}`;
}

/**
 * <pattern> for a hatched bar fill; render it inside the chart's <defs> and
 * fill the bar with `url(#id)`.
 *
 * @param {{ id: string, tint: string, stripe: string }} props
 */
export function HatchPattern({ id, tint, stripe }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" style={{ fill: tint }} />
      <rect width="2" height="6" style={{ fill: stripe }} />
    </pattern>
  );
}

// The hatched comparison bar's background: the colour at 50% over the card.
export function hatchTint(color) {
  return `color-mix(in srgb, ${color} 50%, var(--card))`;
}

/**
 * Legend / tooltip swatch matching a bar: solid, or hatched like the
 * comparison bars.
 *
 * @param {{ color: string, edge?: string, tint?: string, hatched?: boolean }} props
 */
export function PeriodSwatch({ color, edge = edgeColor(color), tint = color, hatched = false }) {
  return (
    <span
      className="size-2.5 shrink-0 rounded-[2px] border"
      style={{
        borderColor: edge,
        background: hatched
          ? `repeating-linear-gradient(45deg, ${edge} 0 1.5px, ${tint} 1.5px 4px)`
          : color,
      }}
      aria-hidden="true"
    />
  );
}
