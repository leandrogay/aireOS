'use client';

import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

// `editing`: the record open in the form. `new`: the record just created or
// changed, so the reader sees where it landed.
const ROW_TINTS = {
  editing: 'bg-lavander/90',
  new: 'bg-lavander/70',
};

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
  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className={cn(
          'h-12 cursor-pointer border-b border-lavander/80 transition-colors',
          ROW_TINTS[highlight] || (isOpen ? 'bg-cream/80' : 'bg-white hover:bg-cream/50'),
        )}
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
      </tr>
      {isOpen && (
        <tr className="border-b border-lavander/80">
          {/* px-4 here is EXPANDED_ROW_INSET in TableGrid: a nested table
              lines its columns up with this table's through it. */}
          <td colSpan={columnCount} className="whitespace-normal bg-cream/50 px-4 py-3">
            {details}
          </td>
        </tr>
      )}
    </Fragment>
  );
}
