'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

export const PAGE_SIZES = [10, 25, 50];

/**
 * Footer of a paged table card: where you are, rows per page, prev / next.
 * Pair it with paginate() in app/utils/tableView.js.
 *
 * @param {{
 *   page: number,
 *   totalPages: number,
 *   pageSize: number,
 *   totalRows: number,
 *   onPageChange: (page: number) => void,
 *   onPageSizeChange: (pageSize: number) => void,
 * }} props
 */
export default function TablePagination({
  page,
  totalPages,
  pageSize,
  totalRows,
  onPageChange,
  onPageSizeChange,
}) {
  const first = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalRows);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-lavander px-4 py-3 text-sm text-deep-violet-blue">
      <p className="text-ink-soft">
        <span className="tabular-nums">
          {first}–{last}
        </span>{' '}
        of <span className="tabular-nums">{totalRows}</span>
        <span className="mx-2 text-lavander">|</span>
        Page <span className="tabular-nums">{page}</span> of{' '}
        <span className="tabular-nums">{totalPages}</span>
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-ink-soft">
          Rows per page
          {/* The browser's own arrow sits hard against the edge, so it is
              hidden and the same chevron as the filter dropdowns
              (ui/FilterSelect) is drawn with their spacing. */}
          <span className="relative">
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-8 appearance-none rounded-glass-sm border border-deep-violet-blue/60 bg-white pl-2.5 pr-8 text-sm text-deep-violet-blue outline-none transition-[border-color] duration-hover hover:border-deep-violet-blue/75 focus-ring"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-deep-violet-blue/50"
            />
          </span>
        </label>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
