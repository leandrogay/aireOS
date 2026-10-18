'use client';

const secondary =
  'rounded-md border border-violet bg-white px-4 py-2 text-sm font-medium text-deep-violet-blue transition hover:bg-lavander focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The rows these rules produce from the mapping's example file (backend POST
 * /api/mappings/{fp}/preview), for a mapping today's transformation runs
 * (contract format 1). A format 2 contract is instructions the transformation
 * will carry out once it reads that format, so its preview re-runs the checks
 * and shows no rows.
 *
 * @param {{
 *   preview: object | null,
 *   isLoading: boolean,
 *   error: string,
 *   onRefresh: () => void,
 *   disabled: boolean,
 *   contractFormat?: number,
 * }} props
 */
export default function OutputPreview({ preview, isLoading, error, onRefresh, disabled, contractFormat = 1 }) {
  const rows = preview?.preview || [];
  const columns = (preview?.columns || []).slice(0, 8);

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-serif text-lg text-deep-violet-blue">Output preview</h3>
        <button type="button" onClick={onRefresh} disabled={isLoading || disabled} className={secondary}>
          {isLoading ? 'Running…' : contractFormat === 2 ? 'Check these rules' : 'Preview these rules'}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {!error && !rows.length && !isLoading && (
        <p className="text-sm text-deep-violet-blue/70">
          {contractFormat === 2
            ? 'This mapping is a set of instructions for the transformation, which does not read this format yet, so there are no output rows to show. Checking re-runs the checks on your edits.'
            : 'Run a preview to see these rules applied to the file this mapping came from, and the checks re-run on them.'}
        </p>
      )}

      {!error && !!rows.length && (
        <>
          <div className="overflow-x-auto rounded-lg border border-lavander">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-lavander text-deep-violet-blue">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="px-3 py-2 font-medium whitespace-nowrap">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-deep-violet-blue">
                {rows.map((row, index) => (
                  <tr key={index} className="border-t border-lavander">
                    {columns.map((column) => (
                      <td key={column} className="px-3 py-2 whitespace-nowrap">
                        {row[column] == null || row[column] === '' ? '—' : String(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-xs text-deep-violet-blue/60">
            {rows.length} of {preview.rows_total?.toLocaleString()} output rows
            {preview.columns?.length > columns.length &&
              ` · ${preview.columns.length - columns.length} more target fields`}
          </p>
        </>
      )}
    </section>
  );
}
