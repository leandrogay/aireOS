// Motion, in one place so its timing and feel are tuned together: the shared
// tokens for motion/react (mirroring the --motion-* CSS variables in
// app/globals.css, which the CSS-driven popups and lists use), then the page
// and tab cascade. The cascade is read by lib/cardCascade.js, which
// components/layout/PageTransition (every page, through PageLayout) and
// components/ui/TabTransition (in-page tab panels: Inventory, Scenario
// builder) call.
//
// The character is Liquid Glass: calm springs with a small overshoot.
// Surfaces materialise (fade in while scaling up a little from where they
// come from) and dematerialise faster than they arrived. Only transform and
// opacity move; nothing waits for an animation, and everything can be clicked
// while it settles.
//
// Users who ask the OS for reduced motion get no animation at all (an instant
// swap): the components check useReducedMotion() or use MotionConfig
// reducedMotion="user", and globals.css gates the CSS animations.

// ==== Shared tokens ====

// Seconds, the same values as the CSS variables (--motion-press: 80ms, ...).
// The exits are shorter than the enters: a surface leaves faster than it came.
export const MOTION_DURATION = {
  press: 0.08,
  hover: 0.14,
  popover: 0.22,
  popoverExit: 0.13,
  dialog: 0.32,
  dialogExit: 0.2,
  page: 0.42,
};

// Cubic-bezier curves, the same as --motion-ease-standard / -enter / -exit.
// standard: state changes in place; enter: decelerates into rest; exit:
// accelerates away.
export const MOTION_EASE = {
  standard: [0.2, 0, 0, 1],
  enter: [0.05, 0.7, 0.1, 1],
  exit: [0.3, 0, 0.8, 0.15],
};

// Spring presets. `visualDuration` (seconds) is how long it feels -- the time
// to reach the target; the overshoot then settles after it. `bounce` is 0 for
// no overshoot, ~0.3 for a gentle one, 0.5+ for a wobbly one.
export const SPRINGS = {
  popover: { type: 'spring', visualDuration: 0.22, bounce: 0.15 },
  dialog: { type: 'spring', visualDuration: 0.32, bounce: 0.2 },
  toast: { type: 'spring', visualDuration: 0.3, bounce: 0.25 },
  press: { type: 'spring', visualDuration: 0.18, bounce: 0.1 },
};

// The rows of a short list rise in this many seconds apart; rows after
// `maxStaggered` start together, so a long list does not keep arriving.
export const LIST_STAGGER = { step: 0.04, maxStaggered: 8 };

// ==== Page and tab cascade ====

// What counts as a card: the page heading row, shadcn <Card>, and the app's
// card frame: the `aire-card` class (defined in globals.css, CardSkeleton
// included). The old class chain (`rounded-lg border border-lavander bg-white
// shadow-sm`) is kept for any frame not yet migrated. Only the outermost match
// springs: a card inside a card moves with its parent.
export const CARD_SELECTOR = [
  '[data-page-heading]',
  '[data-slot="card"]',
  '.aire-card',
  '.rounded-lg.border-lavander.bg-white.shadow-sm',
].join(', ');

// The cascade's spring: each card rises on it with a small, calm overshoot
// (bounce 0.25; it was 0.5, which read as a wobble).
const SPRING = { type: 'spring', visualDuration: 0.3, bounce: 0.25 };

// Opacity is a short tween, not the spring: a bounce would flicker it.
const QUICK_FADE = { duration: 0.12, ease: 'easeOut' };

// On a navigation or tab switch the cards spring in one after another, top to
// bottom: each rises a little on SPRING, with a quick opacity ramp underneath
// so it doesn't pop.
// `y`: how far (px) a card rises. Keep it at 16 or less: the page column sits
// inside <main>'s 16px bottom padding, so the last card's rise never adds
// scroll height or flashes a scrollbar.
// `stagger`: seconds between one card starting and the next.
// `maxStaggered`: cards after this many start together, so a long page
// finishes its cascade quickly (they are below the fold anyway).
// `watchFor`: seconds to keep catching cards that mount late -- real cards
// replacing their skeletons when the data lands. Later than that, content
// just appears.
export const PAGE_CASCADE = {
  y: 14,
  stagger: 0.05,
  maxStaggered: 8,
  watchFor: 0.8,
  transition: { ...SPRING, opacity: QUICK_FADE },
};

// Charts changing in place (hooks/useChartTransition): when a filter changes
// what a chart draws, its bars/lines and its y-axis (range, gridlines, tick
// labels) move together on this one tween, so the axis never snaps while the
// data glides. Seconds; matches the bars' first draw (trendChart BAR_ANIMATION).
export const CHART_TRANSITION = { duration: 0.7, ease: 'easeOut' };

// Loading placeholders (hooks/useDelayedLoading). A placeholder that shows
// for a frame or two before the chart replaces it reads as a flicker, so:
// `delay`: seconds of loading before the placeholder appears at all -- a load
// faster than this goes straight to the chart (its space is held, blank).
// `minDuration`: once shown, seconds it stays at least, so it never blinks.
// The placeholder fades in at the hover speed (the `duration-hover` class in
// the hook, --motion-hover: 140ms).
export const PLACEHOLDER_TIMING = { delay: 0.2, minDuration: 0.4 };

// A card that joins a page already on screen (the mapping review's product
// codes, once a product code column is chosen): it rises on the page spring,
// and the cards below glide down to make room (`layout`, a calmer spring so
// the whole column does not wobble) instead of jumping.
export const CARD_REVEAL = {
  y: PAGE_CASCADE.y,
  transition: PAGE_CASCADE.transition,
  layout: { type: 'spring', visualDuration: 0.3, bounce: 0.15 },
};

// A tab moves less than a page: it is the same place.
export const TAB_CASCADE = {
  ...PAGE_CASCADE,
  y: 8,
};
