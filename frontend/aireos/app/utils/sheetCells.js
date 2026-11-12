// One cell at the top of the example file, named the way a spreadsheet names
// it ("A1"), for a field read from that cell and written on every row
// (backend mapping_contract `from_cell`). The cells come from the layout the
// backend found (layout_detection `cells`: the rows down to just under the
// header, by reference). Pure: no React.

const CELL_REFERENCE = /^([A-Z]{1,3})([1-9]\d*)$/;

/** A reference as the contract stores it ('a1', '$A$1' -> 'A1'), or '' when it is not one. */
export function cleanCellReference(value) {
  const text = String(value ?? '').trim().toUpperCase().replaceAll('$', '');
  return CELL_REFERENCE.test(text) ? text : '';
}

/** The spreadsheet letters of a 1-based column number: 1 is A, 27 is AA. */
export function columnLetters(number) {
  let letters = '';
  let rest = number;
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

function columnNumber(letters) {
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
}

/**
 * The kept cells as a grid to pick from: every row from 1 down to the last
 * one kept and every column from A to the last one used, so it is numbered and
 * lettered as the spreadsheet is. Empty cells are ''.
 *
 * @param {Record<string, string> | undefined} cells
 * @returns {{ columns: string[], rows: { row: number, cells: Record<string, string> }[] }}
 */
export function cellGrid(cells) {
  const parsed = Object.entries(cells || {})
    .map(([reference, value]) => ({ match: CELL_REFERENCE.exec(reference), reference, value }))
    .filter((item) => item.match);
  if (!parsed.length) return { columns: [], rows: [] };

  const lastRow = Math.max(...parsed.map((item) => Number(item.match[2])));
  const lastColumn = Math.max(...parsed.map((item) => columnNumber(item.match[1])));
  const columns = Array.from({ length: lastColumn }, (_, index) => columnLetters(index + 1));
  const rows = Array.from({ length: lastRow }, (_, index) => {
    const row = index + 1;
    return { row, cells: Object.fromEntries(columns.map((column) => [column, cells[`${column}${row}`] ?? ''])) };
  });
  return { columns, rows };
}

/**
 * A cell to start the picker on: for the period, the cell holding the month
 * the file states as a heading ("Jul-26" in A1), else none.
 */
export function cellGuess(layout, field) {
  const stated = layout?.stated_period;
  if (field !== 'period_start' || !stated?.stated_in) return '';
  const found = Object.entries(layout?.cells || {}).find(([, value]) => value === stated.stated_in);
  return found ? found[0] : '';
}
