'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import SelectDropdown from '@/components/ui/SelectDropdown';

export const PAGE_SIZES = [10, 25, 50];
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }));

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
        <div className="flex items-center gap-2 text-deep-violet-blue/70">
          <span>Rows per page</span>
          {/* The outline look matches the prev / next buttons beside it. */}
          <SelectDropdown
            value={String(pageSize)}
            onChange={(value) => onPageSizeChange(Number(value))}
            options={PAGE_SIZE_OPTIONS}
            look="outline"
            tick={false}
            ariaLabel="Rows per page"
            className="w-[4.5rem]"
          />
        </div>
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
