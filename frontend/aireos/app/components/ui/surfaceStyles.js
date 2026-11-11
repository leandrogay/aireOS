// Shared outer card treatment for the AIRE glass pages: frosted glass over the
// wallpaper (aire-glass-surface in globals.css); small floating menus and
// dialogs use aire-glass-float.
export const glassSurfaceClass =
  'aire-glass-surface rounded-2xl border border-card/80 bg-card/75 shadow-xl shadow-deep-violet-blue/10 ring-1 ring-lavander/40';

// Boxes inside a glass card. A lavander edge all but vanishes against frosted
// white, so these take a faint ink edge instead (deep-violet-blue turns light
// in dark mode, so the edge holds in both themes).
// - inset: a group of rows or controls (a field list, a settings block).
// - tableFrame: a hand-rolled table; solid rows, as tables keep on glass
//   (globals.css), with the shared row look from `aire-table-rows`.
// - note: an edgeless detail panel (an explanation under a field).
// - rule: the line between rows inside an inset.
export const glassInsetClass = 'rounded-lg border border-deep-violet-blue/15 bg-white/40';
export const glassTableFrameClass = 'overflow-x-auto rounded-lg border border-deep-violet-blue/15 bg-white';
export const glassNoteClass = 'rounded-lg bg-lavander/45';
export const glassRuleClass = 'border-deep-violet-blue/10';
// A hand-rolled table's header row, in the table kit's colour (ui/TableGrid).
export const glassTableHeadClass = 'bg-(--aire-table-head) text-[11px] text-deep-violet-blue/70';
