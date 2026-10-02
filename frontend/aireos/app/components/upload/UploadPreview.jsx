'use client';

/**
 * The first few rows of an uploaded file after its mapping was applied, from
 * the upload response's `processing.preview`. Wide output (20 target fields)
 * in a narrow card: show the first handful of columns and say how many were
 * left off, rather than a table nobody can read.
 *
 * @param {{ processing: object }} props
 */
export default function UploadPreview({ processing }) {
  const rows = processing?.preview || [];
  if (!rows.length) return null;

  const columns = (processing.columns || Object.keys(rows[0])).slice(0, 6);
  const hidden = (processing.columns || []).length - columns.length;

  return (
    <div className="mt-3">
      <div className="overflow-x-auto rounded-md border border-lavander">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-cream/60 text-deep-violet-blue/70">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-2.5 py-1.5 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-deep-violet-blue">
            {rows.slice(0, 3).map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-lavander">
                {columns.map((column) => (
                  <td key={column} className="whitespace-nowrap px-2.5 py-1.5">
                    {row[column] == null || row[column] === '' ? '—' : String(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <p className="mt-1 text-xs text-deep-violet-blue/60">
          + {hidden} more target field{hidden === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}
