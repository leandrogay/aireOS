import { TABLE_ROWS } from '@/app/config/transitions';

// The motion every list row shares: table rows (TableRow) and phone record
// cards (MobileRecordCard). Timing and the reasons for it are in
// app/config/transitions.js (TABLE_ROWS).
//
// A row reads its enter state from its list (TableGrid's <tbody>,
// RecordCardList) through variant labels, so the list decides when rows
// cascade (a new page, the first load) and in what order; a row that joins the
// list later (a search widening) springs in by itself.

const ROW_VARIANTS = {
  hidden: { opacity: 0, y: TABLE_ROWS.y },
  shown: { opacity: 1, y: 0, transition: TABLE_ROWS.enter },
  gone: { opacity: 0, transition: TABLE_ROWS.exit },
};

// Each row starts `stagger` after the one above, until `maxStaggered`; the
// rest start together (they are below the fold, and waiting on them would
// leave the end of a 50-row page blank for over a second).
export const LIST_VARIANTS = {
  hidden: {},
  shown: {
    transition: {
      delayChildren: (index) => Math.min(index, TABLE_ROWS.maxStaggered) * TABLE_ROWS.stagger,
    },
  },
};

// What a list passes its rows' container (<tbody>, the card grid) to drive
// them; spread on a motion element.
export const LIST_MOTION_PROPS = { initial: 'hidden', animate: 'shown', variants: LIST_VARIANTS };

/**
 * Motion props for one row of a list: enter / exit through the list's
 * variants, and `layout` so it glides when rows above it come or go or the
 * list is re-sorted. `position` only: a row never changes size by moving, and
 * scaling would squash its text. Nothing at all under reduced motion.
 *
 * @param {boolean | null} reduceMotion  useReducedMotion()
 * @returns {object}
 */
export function rowMotionProps(reduceMotion) {
  if (reduceMotion) return {};
  return {
    layout: 'position',
    variants: ROW_VARIANTS,
    exit: 'gone',
    transition: { layout: TABLE_ROWS.glide },
  };
}

const DETAILS_OPEN = { height: 'auto', opacity: 1 };
const DETAILS_CLOSED = { height: 0, opacity: 0 };

/**
 * Motion props for a row's details (ExpandableRow, a phone card's list):
 * they open by growing to their height, so whatever is under them slides down
 * rather than jumps, and close the same way, their contents fading with them.
 * For a motion.div with overflow hidden, inside <AnimatePresence initial={false}>
 * so details already open when the list appears don't slide open.
 *
 * @param {boolean | null} reduceMotion  useReducedMotion()
 * @returns {object}
 */
export function detailsMotionProps(reduceMotion) {
  return {
    initial: reduceMotion ? false : DETAILS_CLOSED,
    animate: DETAILS_OPEN,
    exit: reduceMotion ? undefined : DETAILS_CLOSED,
    transition: { height: TABLE_ROWS.glide, opacity: TABLE_ROWS.exit },
  };
}
