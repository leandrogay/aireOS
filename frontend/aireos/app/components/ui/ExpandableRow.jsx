'use client';

import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { cn } from '@/lib/utils';
import { detailsMotionProps } from '@/components/ui/rowMotion';
import TableRow from '@/components/ui/TableRow';

/**
 * One row of a list table that opens to show `details` underneath, plus the
 * row's "..." menu. Clicking anywhere on the row toggles it; the chevron
 * button in the first cell is the keyboard route to the same toggle.
 *
 *   <ExpandableRow
 *     columnCount={columns.length}
 *     isOpen={isOpen}
 *     onToggle={onToggle}
 *     highlight={isNew ? 'new' : null}
 *     primary={name}
 *     toggleLabel={isOpen ? `Hide details for ${name}` : `Show details for ${name}`}
 *     actions={<RowActions label={`Actions for ${name}`} actions={…} />}
 *     details={<Details … />}
 *   >
 *     <td className="px-4 py-2.5">…</td>
 *   </ExpandableRow>
 *
 * The first cell (chevron + `primary`) and the last cell (`actions`) are
 * drawn here; `children` are the cells between them, so `columnCount` is
 * those plus two. `primary` truncates to its column (full text in `title`)
 * unless `wrapPrimary`, which lets it wrap so it is always read in full.
 *
 * Both rows are TableRows, so they come, go and glide with the table's other
 * rows (TableGrid); the details slide open and shut.
 *
 * @param {{
 *   columnCount: number,
 *   isOpen: boolean,
 *   onToggle: () => void,
 *   primary: import('react').ReactNode,
 *   wrapPrimary?: boolean,
 *   toggleLabel: string,
 *   title?: string,
 *   highlight?: 'editing' | 'new' | null,
 *   actions?: import('react').ReactNode,
 *   details: import('react').ReactNode,
 *   children?: import('react').ReactNode,
 * }} props
 */
export default function ExpandableRow({
  columnCount,
  isOpen,
  onToggle,
  primary,
  wrapPrimary = false,
  toggleLabel,
  title,
  highlight = null,
  actions = null,
  details,
  children,
}) {
  const reduceMotion = useReducedMotion();

  return (
    <Fragment>
      <TableRow
        onClick={onToggle}
        data-expanded={isOpen}
        data-highlight={highlight || undefined}
        className="h-12 cursor-pointer border-b border-lavander/80"
      >
        <td className="px-4 py-2.5 font-medium">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={toggleLabel}
            onClick={(event) => {
              // The row's own onClick toggles too; one toggle per click.
              event.stopPropagation();
              onToggle();
            }}
            className="inline-flex max-w-full items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn('size-4 shrink-0 text-deep-violet-blue/50 transition-transform', isOpen && 'rotate-90')}
            />
            <span
              className={wrapPrimary ? 'whitespace-normal break-words leading-snug' : 'truncate'}
              title={title}
            >
              {primary}
            </span>
          </button>
        </td>
        {children}
        {actions && (
          // React events bubble through portals, so without this a click on
          // a menu item would also reach the row's toggle.
          <td className="px-2 py-1.5 text-right" onClick={(event) => event.stopPropagation()}>
            {actions}
          </td>
        )}
      </TableRow>
      {/* initial={false}: a row already open when the table appears doesn't
          slide open. propagate: when the whole row leaves the table its
          details fade with it. */}
      <AnimatePresence initial={false} propagate>
        {isOpen && (
          <TableRow key="details" className="border-b border-lavander/80">
            {/* px-4 here is EXPANDED_ROW_INSET in TableGrid: a nested table
                lines its columns up with this table's through it. The vertical
                padding sits inside the sliding box so it closes to nothing. */}
            <td colSpan={columnCount} className="whitespace-normal bg-cream/50 px-4 py-0">
              <motion.div
                {...detailsMotionProps(reduceMotion)}
                // Clipped while it slides; -mx-1 px-1 keeps focus rings inside the clip.
                className="-mx-1 overflow-hidden px-1"
              >
                <div className="py-3">{details}</div>
              </motion.div>
            </td>
          </TableRow>
        )}
      </AnimatePresence>
    </Fragment>
  );
}
