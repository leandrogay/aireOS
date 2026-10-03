// Pure helpers shared by the list tables (promotions, recent uploads, stored
// mappings): which rows are on the current page, the "N things" count above
// the table, and how a header press changes the sort.

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
