/**
 * Slider presentation for the actual mechanic values used by the promotion.
 * A range keeps its per-SKU/month values until explicitly overridden; its
 * midpoint is only the thumb's reference position, never an applied uplift.
 */
export function promotionUpliftControl(values, override = null) {
  const expected = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  const low = expected.length ? Math.min(...expected) : 0;
  const high = expected.length ? Math.max(...expected) : 0;
  const reference = Math.round(((low + high) / 2) * 100) / 100;
  const overridden = override != null;
  return {
    expected,
    reference,
    spread: low !== high,
    overridden,
    applied: overridden ? [override] : expected,
    sliderValue: overridden ? override : reference,
  };
}
