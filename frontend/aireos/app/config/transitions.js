// Page and tab transitions, in one place so their timing and feel are tuned
// together. Read by lib/cardCascade.js, which components/layout/PageTransition
// (every page, through PageLayout) and components/ui/TabTransition (in-page tab
// panels: Inventory, Scenario builder) call.
//
// On a navigation or tab switch the cards spring in one after another, top to
// bottom: each rises a little on a bouncy spring, with a quick opacity ramp
// underneath so it doesn't pop. Nothing waits for it, and everything can be
// clicked while it settles.
//
// Users who ask the OS for reduced motion get no animation at all (an instant
// swap); both components check useReducedMotion() themselves.

// What counts as a card: the page heading row, shadcn <Card>, and the app's
// card frame (memory: Sales Dashboard card standard -- `rounded-lg border
// border-lavander bg-white shadow-sm`, CardSkeleton included). Only the
// outermost match springs: a card inside a card moves with its parent.
export const CARD_SELECTOR = [
  '[data-page-heading]',
  '[data-slot="card"]',
  '.aire-glass-surface',
  '.rounded-lg.border-lavander.bg-white.shadow-sm',
].join(', ');

// The spring. `visualDuration` (seconds) is how long it feels -- the time to
// reach the target; the overshoot then settles after it. `bounce` is 0 for no
// overshoot, ~0.3 for a gentle one, 0.5+ for a wobbly one.
const SPRING = { type: 'spring', visualDuration: 0.3, bounce: 0.5 };

// Opacity is a short tween, not the spring: a bounce would flicker it.
const QUICK_FADE = { duration: 0.12, ease: 'easeOut' };

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
// The placeholder fades in over 150ms (the `duration-150` class in the hook).
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

// Table rows and mobile record cards changing in place (components/ui/
// rowMotion.js, read by TableRow, TableGrid, MobileRecordCard, RecordCardList
// and ExpandableRow). A search or filter that drops rows fades them out
// (`exit`), then the rows left glide up into the gap (`glide`). Rows it brings
// back spring in where they belong, a little rise like the cards (`enter`, `y`),
// while the rows around them glide aside. A re-sort glides the same rows to
// their new places. A new page, or the first rows after the loading
// placeholders, cascade in top to bottom (`stagger`, capped at `maxStaggered`
// like the page cascade). `glide` is calmer than the page spring so a long table
// doesn't wobble. The card's own height (a table not filling the screen) and a
// row's details opening follow on `glide` too.
export const TABLE_ROWS = {
  y: 6,
  stagger: 0.03,
  maxStaggered: 10,
  enter: { ...SPRING, opacity: QUICK_FADE },
  exit: { duration: 0.15, ease: 'easeIn' },
  glide: CARD_REVEAL.layout,
};

// A tab moves less than a page: it is the same place.
export const TAB_CASCADE = {
  ...PAGE_CASCADE,
  y: 8,
};

// The refresh arrow (components/ui/RefreshButton). A reload that answers
// in a few milliseconds would barely twitch it, which reads as a broken
// button, so a click spins it at once and it always finishes whole turns:
// at least `minTurns`, then on to the end of the turn it is in when the
// reload lands, so it never snaps back mid-rotation. `turn` (seconds) must
// match the spin class in RefreshButton (SPIN_CLASS).
export const REFRESH_SPIN = { turn: 0.7, minTurns: 1 };
