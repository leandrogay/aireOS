'use client';

import Disclosure from '@/components/ui/Disclosure';
import { glassInsetClass, glassRuleClass } from '@/components/ui/surfaceStyles';
import { cn } from '@/lib/utils';

/**
 * The top of the example file as it sits: the rows above the header (a
 * title, the period it states, outlet codes written over their names), the
 * header, and the first rows of data, numbered as the spreadsheet numbers
 * them. Read off the layout the backend found (layout_detection: header_row,
 * rows_above_header) and the first rows it kept (head_rows), so the reviewer
 * can see which row a field is read from before choosing it.
 *
 * @param {{ columns: string[], layout: object, headRows: Array<Array<string | null>> }} props
 */
export default function FileTop({ columns, layout, headRows }) {
  const above = layout?.rows_above_header || [];
  const headerRow = Number(layout?.header_row) || 1;
  if (!columns.length) return null;

  const rowClass = cn(glassRuleClass, 'border-t');
  const cellClass = 'max-w-40 truncate whitespace-nowrap px-2 py-1';

  return (
    <Disclosure
      className={cn(glassInsetClass, 'mt-2 overflow-hidden')}
      summary={
        <>
          Top of the file
          <span className="font-normal text-deep-violet-blue/60">
            {' '}
            · {above.length ? `${above.length} row${above.length === 1 ? '' : 's'} above the headings, ` : ''}headings on row{' '}
            {headerRow}
          </span>
        </>
      }
    >
      {/* Solid like any table on glass; the sticky row numbers need an
          opaque background so cells don't show through as they scroll under. */}
      <div className={cn(glassRuleClass, 'overflow-x-auto border-t bg-white')}>
        <table className="text-left font-mono text-[11px] text-deep-violet-blue">
          <tbody>
            {above.map((item) => (
              <tr key={`above-${item.row}`} className={cn(rowClass, 'bg-(--aire-row-alt)')}>
                <th scope="row" className="sticky left-0 bg-(--aire-row-alt) px-2 py-1 font-sans font-medium text-deep-violet-blue/60">
                  {item.row}
                </th>
                {columns.map((column) => (
                  <td key={column} className={cellClass} title={item.cells[column] ?? ''}>
                    {item.cells[column] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
            <tr className={cn(rowClass, 'bg-(--aire-table-head) font-sans font-medium')}>
              <th scope="row" className="sticky left-0 bg-(--aire-table-head) px-2 py-1 font-medium text-deep-violet-blue/70">
                {headerRow}
              </th>
              {columns.map((column) => (
                <td key={column} className={cellClass} title={column}>
                  {column}
                </td>
              ))}
            </tr>
            {headRows.map((row, index) => (
              <tr key={`row-${index}`} className={rowClass}>
                <th scope="row" className="sticky left-0 bg-white px-2 py-1 font-sans font-medium text-deep-violet-blue/60">
                  {headerRow + index + 1}
                </th>
                {columns.map((column, columnIndex) => (
                  <td key={column} className={cellClass} title={row[columnIndex] ?? ''}>
                    {row[columnIndex] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!headRows.length && (
        <p className={cn(glassRuleClass, 'border-t px-2 py-1.5 text-[11px] text-deep-violet-blue/60')}>
          This nomenclature was proposed before the first rows were kept. Test it to read them from the example file.
        </p>
      )}
    </Disclosure>
  );
}
