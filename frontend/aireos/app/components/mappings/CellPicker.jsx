'use client';

import { inputClass } from '@/components/ui/formStyles';
import { glassNoteClass, glassRuleClass } from '@/components/ui/surfaceStyles';
import { cellGrid, cleanCellReference } from '@/app/utils/sheetCells';
import { cn } from '@/lib/utils';

const note = cn(glassNoteClass, 'px-2 py-1.5 text-[11px] text-deep-violet-blue');
const headClass = 'sticky bg-(--aire-table-head) px-2 py-1 font-sans font-medium text-deep-violet-blue/60';

/**
 * The top of the example file as a spreadsheet grid, lettered and numbered
 * as Excel shows it, to click the one cell a field is read from (backend
 * mapping_contract from_cell); the cell can also be typed. Says what the
 * chosen cell holds in this file.
 *
 * @param {{ value: string, cells: Record<string, string> | undefined, onChange: (cell: string) => void, period: boolean }} props
 */
export default function CellPicker({ value, cells, onChange, period }) {
  const { columns, rows } = cellGrid(cells);
  const chosen = cleanCellReference(value);
  const read = chosen ? cells?.[chosen] : undefined;

  return (
    <div className="space-y-2">
      {rows.length > 0 ? (
        <div className={cn(glassRuleClass, 'max-h-64 overflow-auto rounded-lg border bg-white')}>
          <table className="text-left font-mono text-[11px] text-deep-violet-blue">
            <thead>
              <tr>
                <th scope="col" className={cn(headClass, 'left-0 top-0 z-20')} aria-label="Row" />
                {columns.map((column) => (
                  <th key={column} scope="col" className={cn(headClass, 'top-0 z-10 text-center')}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.row} className={cn(glassRuleClass, 'border-t')}>
                  <th scope="row" className={cn(headClass, 'left-0 z-10')}>
                    {item.row}
                  </th>
                  {columns.map((column) => {
                    const reference = `${column}${item.row}`;
                    const text = item.cells[column];
                    const selected = reference === chosen;
                    return (
                      <td key={column} className="p-0">
                        <button
                          type="button"
                          disabled={!text}
                          aria-pressed={selected}
                          aria-label={text ? `${reference}: ${text}` : `${reference}: empty`}
                          title={text ? `${reference}: ${text}` : reference}
                          onClick={() => onChange(reference)}
                          className={cn(
                            'block w-full max-w-40 truncate whitespace-nowrap px-2 py-1 text-left transition-colors duration-(--motion-control)',
                            text ? 'cursor-pointer hover:bg-lavander/60' : 'cursor-default',
                            selected && 'bg-lavander font-semibold ring-1 ring-inset ring-deep-violet-blue',
                          )}
                        >
                          {text || ' '}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={note}>
          The cells at the top of the file were not kept when this nomenclature was proposed. Type the cell, then test
          the nomenclature to read the file again.
        </p>
      )}

      <label className="flex items-center gap-2 text-[11px] text-deep-violet-blue/70">
        Cell
        <input
          type="text"
          value={value ?? ''}
          placeholder="A1"
          aria-label="Cell reference"
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClass, 'w-24 py-1 font-mono text-xs uppercase')}
        />
      </label>

      {chosen && read !== undefined && (
        <p className={note}>
          Cell <span className="font-mono font-medium">{chosen}</span> holds{' '}
          <span className="font-medium">“{read}”</span> in this file.{' '}
          {period
            ? 'Every row is dated by it, and each month’s file by its own cell, so it must name a month or a date.'
            : 'It is written on every row, and each file gives its own.'}
        </p>
      )}
      {chosen && read === undefined && rows.length > 0 && (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          Cell {chosen} is empty, or lies below the top of the file, so testing on this file will fail.
        </p>
      )}
    </div>
  );
}
