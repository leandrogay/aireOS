'use client';

const btn =
  'rounded-md border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60';

// A rule may read a column the packet does not otherwise declare -- a composite
// like "Brand + MCH", or a value from outside the sheet entirely. Offer those
// alongside the declared columns so editing cannot silently drop one.
const sourceOptionsFor = (mapping) => {
  const declared = mapping.columns || [];
  const inUse = (mapping.rules || []).map((rule) => rule.sourceColumn).filter(Boolean);
  return Array.from(new Set([...declared, ...inUse]));
};

// The identifying line shown both on the collapsed summary row and at the
// top of the expanded card, so the two states read as the same mapping.
const MappingIdentity = ({ mapping }) => (
  <div className="min-w-0">
    <p className="truncate font-medium text-deep-violet-blue">
      {mapping.filename || mapping.mappingId}
    </p>
    {mapping.retailerFamily && (
      <p className="truncate text-xs text-deep-violet-blue/70">Retailer: {mapping.retailerFamily}</p>
    )}
  </div>
);

const MappingStatBadges = ({ mapping }) => {
  const ruleCount = mapping.rules?.length || 0;
  const unmappedCount = mapping.unmapped?.length || 0;
  const missingCount = mapping.requiredMissing?.length || 0;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-600">
        {ruleCount} rule{ruleCount === 1 ? '' : 's'}
      </span>
      {missingCount > 0 && (
        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900">
          {missingCount} missing
        </span>
      )}
      {unmappedCount > 0 && (
        <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-600">
          {unmappedCount} unmapped
        </span>
      )}
    </div>
  );
};

export const MappingReview = ({
  mapping,
  isEditing = false,
  isExpanded = true,
  onToggleExpanded,
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

  // Collapsed: a single scannable row. Its own section header already
  // carries the built-in/confirmed/pending distinction, so the row itself
  // only needs to say which mapping this is and how big it is.
  if (onToggleExpanded && !isExpanded) {
    return (
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left text-sm transition hover:border-deep-violet-blue/40 hover:bg-lavander/30"
      >
        <span className="text-zinc-400">▸</span>
        <MappingIdentity mapping={mapping} />
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <MappingStatBadges mapping={mapping} />
        </span>
      </button>
    );
  }

  return (
    <section className="rounded-xl border border-deep-violet-blue/20 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {onToggleExpanded && (
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-label="Collapse mapping"
              className="mt-1 shrink-0 text-zinc-400 hover:text-deep-violet-blue"
            >
              ▾
            </button>
          )}
          <div className="min-w-0">
            <MappingIdentity mapping={mapping} />
          </div>
        </div>
        <div className="shrink-0 text-sm text-deep-violet-blue/80">
          {mapping.fingerprint ? 'Fingerprint: ' : 'ID: '}
          <span className="font-mono text-xs">{mapping.mappingId}</span>
        </div>
      </div>

      <div className="mb-4">
        <MappingStatBadges mapping={mapping} />
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
        <table className="w-full table-fixed divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="w-[20%] px-3 py-2 text-left font-semibold text-zinc-700">Target Field</th>
              <th className="w-[25%] px-3 py-2 text-left font-semibold text-zinc-700">Sample</th>
              <th className="w-[30%] px-3 py-2 text-left font-semibold text-zinc-700">Source Column</th>
              <th className="w-[25%] px-3 py-2 text-left font-semibold text-zinc-700">Rule</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {(mapping.rules || []).map((rule, index) => (
              <tr key={`${mapping.mappingId}-${rule.targetField}-${index}`}>
                <td className="px-3 py-2 align-top font-mono text-zinc-900">
                  <span className="block whitespace-normal break-words" title={rule.targetField}>
                    {rule.targetField}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  {rule.sample ? (
                    <span className="block whitespace-normal break-words text-zinc-700" title={rule.sample}>
                      {rule.sample}
                    </span>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
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
                    <span className="block whitespace-normal break-words text-zinc-900" title={rule.sourceColumn}>
                      {rule.sourceColumn}
                    </span>
                  ) : (
                    <span className="text-zinc-400">No source</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {rule.transform ? (
                    <span className="block whitespace-normal break-words text-zinc-700" title={rule.transform}>
                      {rule.transform}
                    </span>
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
