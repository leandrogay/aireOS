'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

export const PAGE_SIZES = [10, 25, 50];

/**
 * Footer of the promotion table: where you are, rows per page, prev / next.
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
export default function PromotionPagination({
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
      <p className="text-deep-violet-blue/70">
        <span className="tabular-nums">
          {first}–{last}
        </span>{' '}
        of <span className="tabular-nums">{totalRows}</span>
        <span className="mx-2 text-lavander">|</span>
        Page <span className="tabular-nums">{page}</span> of{' '}
        <span className="tabular-nums">{totalPages}</span>
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-deep-violet-blue/70">
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-lg border border-lavander bg-white px-2 text-sm text-deep-violet-blue outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
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
