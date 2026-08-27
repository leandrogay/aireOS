'use client';

const btn =
  'rounded-md border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60';

const STATE_LABEL = {
  builtin: 'Built-in mapping',
  confirmed: 'Confirmed mapping',
  pending: 'Proposed mapping',
};

// A rule may read a column the packet does not otherwise declare -- a composite
// like "Brand + MCH", or a value from outside the sheet entirely. Offer those
// alongside the declared columns so editing cannot silently drop one.
const sourceOptionsFor = (mapping) => {
  const declared = mapping.columns || [];
  const inUse = (mapping.rules || []).map((rule) => rule.sourceColumn).filter(Boolean);
  return Array.from(new Set([...declared, ...inUse]));
};

export const MappingReview = ({
  mapping,
  isEditing = false,
  onStartEdit,
  onCancelEdit,
  onSourceChange,
  onConfirm,
  onDiscard,
  disabled = false,
}) => {
  const sourceOptions = sourceOptionsFor(mapping);
  const isPending = mapping.state === 'pending';
  const isBuiltin = mapping.state === 'builtin';

  return (
    <section className="rounded-xl border border-deep-violet-blue/20 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 inline-flex rounded-full border border-deep-violet-blue/20 bg-lavander px-3 py-1 text-xs font-semibold uppercase tracking-wide text-deep-violet-blue">
            {STATE_LABEL[mapping.state] || mapping.state}
          </div>
          <h2 className="font-serif text-xl text-deep-violet-blue">Mapping Rules</h2>
          {mapping.filename && (
            <p className="text-sm text-deep-violet-blue/80">
              From: <span className="font-medium">{mapping.filename}</span>
            </p>
          )}
          {mapping.retailerFamily && (
            <p className="text-sm text-deep-violet-blue/80">
              Retailer: <span className="font-medium">{mapping.retailerFamily}</span>
            </p>
          )}
        </div>
        <div className="text-sm text-deep-violet-blue/80">
          {mapping.fingerprint ? 'Fingerprint: ' : 'ID: '}
          <span className="font-mono text-xs">{mapping.mappingId}</span>
        </div>
      </div>

      {isBuiltin && (
        <p className="mb-4 rounded-lg border border-deep-violet-blue/20 bg-lavander/50 p-3 text-sm text-deep-violet-blue">
          These rules run as code in <span className="font-mono text-xs">apply_existing_mapping</span>,
          so they are shown for reference and cannot be edited here.
        </p>
      )}

      {mapping.requiredMissing?.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Missing required target fields: {mapping.requiredMissing.join(', ')}
        </div>
      )}

      {mapping.warnings?.length > 0 && (
        <ul className="mb-4 list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 pl-7 text-sm text-amber-900">
          {mapping.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-zinc-700">Target Field</th>
              <th className="px-3 py-2 text-left font-semibold text-zinc-700">Source Column</th>
              <th className="px-3 py-2 text-left font-semibold text-zinc-700">Rule</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {(mapping.rules || []).map((rule, index) => (
              <tr key={`${mapping.mappingId}-${rule.targetField}-${index}`}>
                <td className="px-3 py-2 font-mono text-zinc-900">{rule.targetField}</td>
                <td className="px-3 py-2">
                  {isEditing && rule.editable !== false ? (
                    <select
                      value={rule.sourceColumn || ''}
                      onChange={(event) => onSourceChange(mapping.mappingId, index, event.target.value)}
                      disabled={disabled}
                      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-deep-violet-blue focus:outline-none"
                    >
                      <option value="">Select source column</option>
                      {sourceOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : rule.sourceColumn ? (
                    <span className="text-zinc-900">{rule.sourceColumn}</span>
                  ) : (
                    <span className="text-zinc-400">No source</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {rule.transform ? (
                    <span className="text-zinc-700">{rule.transform}</span>
                  ) : (
                    <span className="text-zinc-400">Direct</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mapping.unmapped?.length > 0 && (
        <p className="mt-3 text-sm text-deep-violet-blue/70">
          Source columns no rule reads:{' '}
          <span className="text-deep-violet-blue/90">{mapping.unmapped.join(', ')}</span>
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-deep-violet-blue/80">
          {isPending
            ? 'Proposed by Claude. Review the rules, then confirm to store them.'
            : mapping.validated
              ? `Confirmed${mapping.validatedAt ? ` on ${new Date(mapping.validatedAt).toLocaleString()}` : ''}`
              : 'Not yet confirmed.'}
        </p>

        <div className="flex items-center gap-3">
          {!isBuiltin && !isEditing && onStartEdit && (
            <button
              type="button"
              onClick={() => onStartEdit(mapping.mappingId)}
              disabled={disabled}
              className={`${btn} border-deep-violet-blue bg-white text-deep-violet-blue hover:bg-lavander`}
            >
              Edit mapping
            </button>
          )}

          {isEditing && onCancelEdit && (
            <button
              type="button"
              onClick={() => onCancelEdit(mapping.mappingId)}
              disabled={disabled}
              className={`${btn} border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50`}
            >
              Cancel
            </button>
          )}

          {isPending && onDiscard && (
            <button
              type="button"
              onClick={() => onDiscard(mapping.mappingId)}
              disabled={disabled}
              className={`${btn} border-red-300 bg-white text-red-700 hover:bg-red-50`}
            >
              Discard
            </button>
          )}

          {!isBuiltin && (isEditing || isPending) && (
            <button
              type="button"
              onClick={() => onConfirm(mapping.mappingId)}
              disabled={disabled}
              className={`${btn} border-deep-violet-blue bg-deep-violet-blue text-white hover:opacity-90`}
            >
              {isPending ? 'Confirm mapping' : 'Save amendments'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
