'use client';

import { CheckCircle2, Sparkles, CircleAlert, X } from 'lucide-react';

/**
 * Which of the business fields this mapping fills, and which it doesn't.
 *
 * The unmapped ones come first and carry their own column picker, because
 * "what is still missing, and how do I fix it" is the question this screen
 * exists to answer — making someone find the right row in a table of thirty
 * source columns to fix a field they can see is missing is the long way round.
 *
 * @param {{
 *   coverage: object[],
 *   rows: object[],
 *   onAssign: (field: string, column: string) => void,
 *   onClear: (field: string) => void,
 *   readOnly?: boolean,
 * }} props
 */
export default function FieldCoverage({ coverage, rows, onAssign, onClear, readOnly = false }) {
  const covered = coverage.filter((entry) => entry.status !== 'unmapped');
  const missing = coverage.filter((entry) => entry.status === 'unmapped');
  const percent = coverage.length ? Math.round((covered.length / coverage.length) * 100) : 0;

  // A melt group's columns can't be repointed one at a time, so they are not
  // offered. Columns filling nothing come first, but a column that already
  // fills a field is just as valid a choice — one column can carry several
  // fields, so picking it adds to what it does rather than replacing it.
  const assignable = rows.filter((row) => !row.locked);
  const free = assignable.filter((row) => !row.fields.length);
  const taken = assignable.filter((row) => row.fields.length > 0);

  return (
    <section className="rounded-xl border border-lavander bg-white p-6 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="font-serif text-lg text-deep-violet-blue">Field coverage</h3>
          <p className="text-xs text-deep-violet-blue/70">
            The fields this mapping is expected to fill.
          </p>
        </div>
        <p className="text-sm font-medium text-deep-violet-blue">
          {covered.length} of {coverage.length} mapped
        </p>
      </div>

      <div
        className="mb-5 h-2 w-full overflow-hidden rounded-full bg-lavander"
        role="progressbar"
        aria-valuenow={covered.length}
        aria-valuemin={0}
        aria-valuemax={coverage.length}
        aria-label={`${covered.length} of ${coverage.length} fields mapped`}
      >
        <div
          className="h-full rounded-full bg-deep-violet-blue transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      {missing.length > 0 && (
        <div className="mb-5">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <CircleAlert aria-hidden="true" className="size-4" />
            Not yet mapped ({missing.length})
          </h4>
          <ul className="space-y-2">
            {missing.map((entry) => (
              <li
                key={entry.field}
                className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-mono text-xs font-semibold text-amber-900">
                  {entry.field}
                </span>
                <select
                  value=""
                  disabled={readOnly}
                  onChange={(event) => {
                    if (event.target.value) onAssign(entry.field, event.target.value);
                  }}
                  aria-label={`Choose the source column for ${entry.field}`}
                  className="w-full rounded-md border border-amber-400 bg-white px-2 py-1.5 text-xs text-deep-violet-blue focus:border-deep-violet-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue disabled:opacity-60 sm:w-64"
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
              </li>
            ))}
          </ul>
          {!assignable.length && (
            <p className="mt-2 text-xs text-deep-violet-blue/70">
              Every column in this file belongs to a period group, so there is nothing to
              assign these from.
            </p>
          )}
        </div>
      )}

      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-green-800">
          <CheckCircle2 aria-hidden="true" className="size-4" />
          Mapped ({covered.length})
        </h4>

        {covered.length === 0 ? (
          <p className="text-xs text-deep-violet-blue/70">Nothing is mapped yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {covered.map((entry) => (
              <li
                key={entry.field}
                className="flex items-center justify-between gap-2 rounded-lg border border-lavander bg-cream px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-deep-violet-blue">
                    {entry.field}
                  </p>
                  <p className="flex items-center gap-1 truncate text-[11px] text-deep-violet-blue/70">
                    {entry.status === 'auto' ? (
                      <>
                        <Sparkles aria-hidden="true" className="size-3 shrink-0" />
                        Read from the period columns
                      </>
                    ) : (
                      <span className="truncate" title={entry.column}>
                        from {entry.column}
                      </span>
                    )}
                  </p>
                </div>

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
