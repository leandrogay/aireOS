// Pure helpers shared by the list tables (customers, promotions, recent
// uploads, stored mappings): which rows are on the current page, the "N
// things" count above the table, how a header press changes the sort, and
// the "first +N" label for a cell listing many names.

/**
 * The slice of `rows` on `page`. The page is clamped rather than trusted, so
 * a list that shrinks under the reader (a delete, a narrower search) lands on
 * its new last page instead of an empty one.
 *
 * @template T
 * @param {T[]} rows
 * @param {number} page
 * @param {number} pageSize
 * @returns {{ pageRows: T[], currentPage: number, totalPages: number }}
 */
export function paginate(rows, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return { pageRows, currentPage, totalPages };
}

/**
 * "70 promotions" when nothing is filtered out, "12 of 70 promotions" when
 * the filters or search narrow the list.
 *
 * @param {number} shown
 * @param {number} total
 * @param {string} singular
 * @param {string} [plural]
 * @returns {string}
 */
export function resultCountLabel(shown, total, singular, plural = `${singular}s`) {
  const noun = total === 1 ? singular : plural;
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}

/**
 * Sort after a header press: the same column flips direction, a new column
 * starts ascending.
 *
 * @param {{ field: string | null, direction: 'asc' | 'desc' }} sort
 * @param {string} field
 * @returns {{ field: string, direction: 'asc' | 'desc' }}
 */
export function nextSort(sort, field) {
  if (sort.field === field) {
    return { field, direction: sort.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { field, direction: 'asc' };
}

/**
 * Case-insensitive "does any of these values contain the query". An empty
 * query matches everything.
 *
 * @param {Array<string | null | undefined>} values
 * @param {string} query
 * @returns {boolean}
 */
export function matchesSearch(values, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value || '').toLowerCase().includes(needle));
}

/**
 * Short label for a list of names in one table cell: the first one, plus
 * "+N" when there are more. Put the full list in the cell's `title`.
 *
 * @param {string[]} names
 * @param {string} [empty]
 * @returns {string}
 */
export function summariseNames(names, empty = '—') {
  if (!names.length) return empty;
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

// ---- Block paging ----------------------------------------------------------
//
// For a list the backend pages (Recent uploads): the table asks for a block of
// rows bigger than one page and pages through it locally, so Next / Prev
// inside the block need no request. The block size must be a multiple of
// every page size, so a page never straddles two blocks.

/**
 * The block of rows to ask the backend for, so that `page` is inside it.
 *
 * @param {number} page
 * @param {number} pageSize
 * @param {number} blockSize
 * @returns {{ offset: number, limit: number }}
 */
export function blockQuery(page, pageSize, blockSize) {
  const start = (page - 1) * pageSize;
  return { offset: Math.floor(start / blockSize) * blockSize, limit: blockSize };
}

/**
 * The page to show from the block the backend last answered with: `page`
 * clamped to the last page (the list may have shrunk), its rows sliced out
 * of the block. While the block for `page` is still being read, the nearest
 * page of the loaded block is shown instead, so the rows on screen and the
 * page number in the footer always agree.
 *
 * @template T
 * @param {{ rows: T[], offset: number, total: number } | null} block
 * @param {number} page
 * @param {number} pageSize
 * @returns {{ pageRows: T[], currentPage: number, totalPages: number }}
 */
export function pageFromBlock(block, page, pageSize) {
  if (!block) return { pageRows: [], currentPage: page, totalPages: 1 };

  const totalPages = Math.max(1, Math.ceil(block.total / pageSize));
  const wanted = (Math.min(page, totalPages) - 1) * pageSize;
  const blockEnd = block.offset + block.rows.length;
  const covered = block.rows.length === 0 || (wanted >= block.offset && wanted < blockEnd);
  const start = covered
    ? wanted
    : Math.floor(Math.min(Math.max(wanted, block.offset), blockEnd - 1) / pageSize) * pageSize;

  return {
    pageRows: block.rows.slice(start - block.offset, start - block.offset + pageSize),
    currentPage: Math.floor(start / pageSize) + 1,
    totalPages,
  };
}
