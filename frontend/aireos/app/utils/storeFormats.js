// AIRE palette assigned per store format, shared by the trend chart and the
// Sell-out Summary mix bar so a format is the same colour everywhere. Reused
// across offline (4 formats) and online (1 format) since only one channel is
// ever on screen at once — safe to reuse HYPER's colour for FPON since they
// never render together. FPON previously used --aire-cream, which is nearly
// invisible against the white card/cream page background.
export const FORMAT_COLORS = {
  HYPER: 'var(--aire-deep-blue)',
  SUPER: 'var(--aire-violet)',
  FINEST: 'var(--aire-celest)',
  UNITY: 'var(--aire-lavender)',
  FPON: 'var(--aire-deep-blue)',
};

// Formats the catalog doesn't know ("UNKNOWN") still get a visible colour.
export const FALLBACK_FORMAT_COLOR = 'var(--aire-violet)';
