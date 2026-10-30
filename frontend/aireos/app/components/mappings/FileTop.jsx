'use client';

import Disclosure from '@/components/ui/Disclosure';
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

  const rowClass = 'border-t border-lavander';
  const cellClass = 'max-w-40 truncate whitespace-nowrap px-2 py-1';

  return (
    <Disclosure
      className="mt-2 rounded-md border border-lavander"
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
      <div className="overflow-x-auto border-t border-lavander">
        <table className="text-left font-mono text-[11px] text-deep-violet-blue">
          <tbody>
            {above.map((item) => (
              <tr key={`above-${item.row}`} className={cn(rowClass, 'bg-cream/40')}>
                <th scope="row" className="sticky left-0 bg-cream px-2 py-1 font-sans font-medium text-deep-violet-blue/60">
                  {item.row}
                </th>
                {columns.map((column) => (
                  <td key={column} className={cellClass} title={item.cells[column] ?? ''}>
                    {item.cells[column] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
            <tr className={cn(rowClass, 'bg-lavander/50 font-sans font-medium')}>
              <th scope="row" className="sticky left-0 bg-lavander px-2 py-1 font-medium text-deep-violet-blue/70">
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
        <p className="border-t border-lavander px-2 py-1.5 text-[11px] text-deep-violet-blue/60">
          This mapping was proposed before the first rows were kept. Test it to read them from the example file.
        </p>
      )}
    </Disclosure>
  );
}
