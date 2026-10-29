'use client';

import { fieldLabel } from '../../utils/mappingReview';

/**
 * The rows these rules produce from the mapping's example file (backend POST
 * /api/mappings/{fp}/preview), using the same deterministic transformation as
 * approval and future recognised uploads. The run itself is started by the
 * review step this sits in, which shows this only once a run has rows.
 *
 * The load confirmation (LoadConfirmDialog) shows the same table for each
 * file it would load, naming the `fields` worth reading there -- the
 * figures, not every column -- and the `total` it will store.
 *
 * @param {{
 *   preview: { preview: object[], columns: string[], rows_total: number },
 *   fields?: string[],
 *   total?: number,
 * }} props
 */
export default function OutputPreview({ preview, fields, total = preview.rows_total }) {
  const rows = preview.preview;
  const columns = fields
    ? fields.filter((field) => (preview.columns || []).includes(field))
    : (preview.columns || []).slice(0, 8);

  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-lavander">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-cream/60 text-[11px] text-deep-violet-blue/70">
            <tr>
              {columns.map((column) => (
                <th key={column} className="whitespace-nowrap px-2 py-1.5 font-medium">
                  {fieldLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-deep-violet-blue">
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-lavander">
                {columns.map((column) => (
                  <td key={column} className="whitespace-nowrap px-2 py-1.5">
                    {row[column] == null || row[column] === '' ? '—' : String(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-deep-violet-blue/60">
        First {rows.length} of {total?.toLocaleString()} sales rows
        {preview.columns?.length > columns.length && ` · ${preview.columns.length - columns.length} more fields not shown`}
      </p>
    </div>
  );
}
