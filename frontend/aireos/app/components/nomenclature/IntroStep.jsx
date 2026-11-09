'use client';

import { FileSpreadsheet, Trash2 } from 'lucide-react';

import { PROPOSER, proposedByLabel } from '@/app/utils/mappingReview';

// How much of the file the peek shows: enough to recognise it, not a spreadsheet.
const PEEK_COLUMNS = 10;
const PEEK_ROWS = 5;

/**
 * The top of the example file: the row the column names were read from,
 * highlighted, and the first rows of data under it -- so the reviewer can tell
 * at a glance that the right table was found.
 */
function FilePeek({ columns, headerRow, headRows }) {
  const shown = columns.slice(0, PEEK_COLUMNS);
  const more = columns.length - shown.length;
  const cell = 'max-w-36 truncate whitespace-nowrap px-2 py-1.5';

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-lavander">
      <p className="border-b border-lavander bg-cream/40 px-3 py-2 text-sm font-medium text-deep-violet-blue">
        The top of your file
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-deep-violet-blue">
          <tbody>
            <tr className="bg-lavander font-medium">
              <th scope="row" className="w-10 px-2 py-1.5 font-medium text-deep-violet-blue/80">
                {headerRow}
              </th>
              {shown.map((column) => (
                <td key={column} className={cell} title={column}>
                  {column}
                </td>
              ))}
              {more > 0 && <td className="px-2 py-1.5 whitespace-nowrap">+{more} more</td>}
            </tr>
            {headRows.slice(0, PEEK_ROWS).map((row, index) => (
              <tr key={index} className="border-t border-lavander font-mono">
                <th scope="row" className="px-2 py-1.5 font-sans font-medium text-deep-violet-blue/80">
                  {headerRow + index + 1}
                </th>
                {shown.map((column, columnIndex) => (
                  <td key={column} className={cell} title={row[columnIndex] ?? ''}>
                    {row[columnIndex] ?? ''}
                  </td>
                ))}
                {more > 0 && <td />}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-lavander px-3 py-2 text-xs text-deep-violet-blue/80">
        The highlighted row is where the column names were read (row {headerRow} of the file).
        {!headRows.length && ' The first rows were not kept for this nomenclature; testing it reads them again.'}
      </p>
    </div>
  );
}

function Fact({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-lavander py-2 first:border-t-0">
      <dt className="text-sm text-deep-violet-blue/80">{label}</dt>
      <dd className="text-right text-sm font-medium text-deep-violet-blue">{children}</dd>
    </div>
  );
}

/**
 * The first screen: the file this nomenclature was made from and what was
 * read from it, beside a look at the top of the file itself.
 *
 * @param {{
 *   mapping: object,
 *   layout: object,
 *   headRows: Array<Array<string | null>>,
 *   codeCount: number,
 *   canDiscard: boolean,
 *   onDiscard: () => void,
 *   disabled: boolean,
 * }} props
 */
export default function IntroStep({ mapping, layout, headRows, codeCount, canDiscard, onDiscard, disabled }) {
  const isConfirmed = mapping.state === 'confirmed';
  const file = mapping.sourceFilename || String(mapping.filename || '').split('/').pop();
  const model = proposedByLabel(mapping.proposedBy);
  const columns = mapping.columns || [];
  const headerRow = Number(layout?.header_row) || 1;
  const stated = layout?.stated_period;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
      {columns.length > 0 ? (
        <FilePeek columns={columns} headerRow={headerRow} headRows={headRows} />
      ) : (
        <p className="text-sm text-deep-violet-blue/80">The columns of this file were not kept.</p>
      )}

      <div className="space-y-3">
        <div className="rounded-lg border border-lavander p-3">
          <p className="flex items-start gap-2 text-sm font-medium text-deep-violet-blue" title={mapping.filename || undefined}>
            <FileSpreadsheet aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{file || 'Example file'}</span>
          </p>
          <p className="mt-1 text-xs text-deep-violet-blue/80">
            {isConfirmed
              ? `Live · version ${mapping.version || 1}. Saving makes a new version.`
              : `Proposed by ${PROPOSER}${model ? ` (${model})` : ''}. Nothing is saved until you approve.`}
          </p>

          <dl className="mt-2 border-t border-lavander pt-1">
            <Fact label="Columns">{columns.length}</Fact>
            <Fact label="Column names on">row {headerRow}</Fact>
            <Fact label="Product codes">{codeCount}</Fact>
            {stated && (
              <Fact label="The file says it covers">
                {stated.start} to {stated.end}
              </Fact>
            )}
          </dl>
        </div>

        {canDiscard && (
          <button
            type="button"
            onClick={onDiscard}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-red-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700/40"
          >
            <Trash2 aria-hidden="true" className="size-4" />
            Wrong file or table? Discard this proposal
          </button>
        )}
      </div>
    </div>
  );
}
