'use client';

import { CheckCircle2, CircleAlert, MinusCircle, Sparkles, X } from 'lucide-react';

import { needsFieldReview } from '../../utils/mappingReview';

const confirmButton =
  'shrink-0 rounded-md border border-deep-violet-blue bg-white px-2 py-1 text-[11px] font-medium text-deep-violet-blue transition hover:bg-lavander focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue disabled:opacity-60';

/**
 * A picker of the file's columns for one field. Columns filling nothing come
 * first, but a column that already fills a field is just as valid a choice --
 * one column can carry several fields, so picking it adds to what it does.
 */
function ColumnPicker({ field, rows, onAssign, disabled, tone = 'amber' }) {
  const assignable = rows.filter((row) => !row.locked);
  const free = assignable.filter((row) => !row.fields.length);
  const taken = assignable.filter((row) => row.fields.length > 0);
  const border = tone === 'amber' ? 'border-amber-400' : 'border-violet';

  return (
    <select
      value=""
      disabled={disabled || !assignable.length}
      onChange={(event) => {
        if (event.target.value) onAssign(field, event.target.value);
      }}
      aria-label={`Choose the source column for ${field}`}
      className={`w-full rounded-md border ${border} bg-white px-2 py-1.5 text-xs text-deep-violet-blue focus:border-deep-violet-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue disabled:opacity-60 sm:w-64`}
    >
      <option value="">Choose a column…</option>
      {free.length > 0 && (
        <optgroup label="Columns not used yet">
          {free.map((row) => (
            <option key={row.column} value={row.column}>
              {row.column}
            </option>
          ))}
        </optgroup>
      )}
      {taken.length > 0 && (
        <optgroup label="Columns that already fill a field — adds to it">
          {taken.map((row) => (
            <option key={row.column} value={row.column}>
              {row.column} → {row.fields.map((f) => f.targetField).join(', ')}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/**
 * Every field of the sell-out schema and how this mapping fills it: from a
 * column, automatically (a constant, computed, or written by the pipeline), or not at
 * all because the file does not hold it -- which is a decision, with a reason,
 * not a gap.
 *
 * Required fields that nothing fills come first, with their own column
 * picker, because "what is still missing, and how do I fix it" is the
 * question this screen exists to answer. A decision the proposal was unsure
 * of carries a Confirm button wherever it is listed.
 *
 * @param {{
 *   coverage: object[],
 *   rows: object[],
 *   requiredFields: string[],
 *   onAssign: (field: string, column: string) => void,
 *   onClear: (field: string) => void,
 *   onConfirmField: (field: string) => void,
 *   readOnly?: boolean,
 * }} props
 */
export default function FieldCoverage({
  coverage,
  rows,
  requiredFields = [],
  onAssign,
  onClear,
  onConfirmField,
  readOnly = false,
}) {
  const required = new Set(requiredFields);
  const missing = coverage.filter(
    (entry) => entry.status === 'unmapped' || (entry.status === 'not_available' && required.has(entry.field)),
  );
  const notInFile = coverage.filter((entry) => entry.status === 'not_available' && !required.has(entry.field));
  const filled = coverage.filter((entry) => entry.status === 'mapped' || entry.status === 'auto');
  const fromFile = filled.filter((entry) => entry.status === 'mapped').length;

  const confirm = (entry) =>
    !readOnly &&
    needsFieldReview(entry) && (
      <button type="button" onClick={() => onConfirmField(entry.field)} className={confirmButton}>
        Confirm
      </button>
    );

  return (
    <section className="rounded-lg border border-lavander bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="font-serif text-lg text-deep-violet-blue">Field coverage</h3>
          <p className="text-xs text-deep-violet-blue/70">
            Every field of the sell-out data, and where this mapping gets it.
          </p>
        </div>
        <p className="text-sm font-medium text-deep-violet-blue">
          {fromFile} from the file · {filled.length - fromFile} automatic · {notInFile.length} not in this file
        </p>
      </div>

      {missing.length > 0 && (
        <div className="mb-5">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <CircleAlert aria-hidden="true" className="size-4" />
            Needs a column ({missing.length})
          </h4>
          <ul className="space-y-2">
            {missing.map((entry) => (
              <li
                key={entry.field}
                className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-amber-900">
                    {entry.field}
                    {required.has(entry.field) && <span className="ml-1 font-sans font-normal">(required)</span>}
                  </p>
                  {entry.reason && <p className="text-[11px] text-amber-900/80">{entry.reason}</p>}
                </div>
                <ColumnPicker field={entry.field} rows={rows} onAssign={onAssign} disabled={readOnly} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {notInFile.length > 0 && (
        <div className="mb-5">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-deep-violet-blue">
            <MinusCircle aria-hidden="true" className="size-4" />
            Not in this file ({notInFile.length})
          </h4>
          <ul className="space-y-2">
            {notInFile.map((entry) => (
              <li
                key={entry.field}
                className="flex flex-col gap-2 rounded-lg border border-lavander bg-cream p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-deep-violet-blue">{entry.field}</p>
                  <p className="text-[11px] text-deep-violet-blue/70">{entry.reason || 'Left empty.'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {confirm(entry)}
                  <ColumnPicker field={entry.field} rows={rows} onAssign={onAssign} disabled={readOnly} tone="violet" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-green-800">
          <CheckCircle2 aria-hidden="true" className="size-4" />
          Filled ({filled.length})
        </h4>

        {filled.length === 0 ? (
          <p className="text-xs text-deep-violet-blue/70">Nothing is mapped yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {filled.map((entry) => (
              <li
                key={entry.field}
                className="flex items-center justify-between gap-2 rounded-lg border border-lavander bg-cream px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-deep-violet-blue">{entry.field}</p>
                  <p className="flex items-center gap-1 truncate text-[11px] text-deep-violet-blue/70">
                    {entry.status === 'auto' ? (
                      <>
                        <Sparkles aria-hidden="true" className="size-3 shrink-0" />
                        <span className="truncate" title={entry.description}>
                          {entry.description}
                        </span>
                      </>
                    ) : (
                      <span className="truncate" title={entry.column || entry.description}>
                        from {entry.column || entry.description}
                      </span>
                    )}
                  </p>
                </div>

                {confirm(entry)}
                {!readOnly && entry.status === 'mapped' && !entry.locked && (
                  <button
                    type="button"
                    onClick={() => onClear(entry.field)}
                    aria-label={`Unmap ${entry.field}`}
                    title={`Unmap ${entry.field}`}
                    className="shrink-0 rounded-md border border-violet bg-white p-1 text-deep-violet-blue transition hover:bg-lavander focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
