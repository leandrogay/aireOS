'use client';

const TARGET_FIELD_OPTIONS = [
  '',
  'sku',
  'product_name',
  'quantity_units',
  'revenue',
  'period_start',
  'period_type',
  'retailer',
  'store_code',
];

const badgeClassForConfidence = (confidence) => {
  if (confidence >= 0.9) return 'bg-green-100 text-green-800 border-green-200';
  if (confidence >= 0.7) return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-red-100 text-red-800 border-red-200';
};

const badgeClassForStatus = (status) => {
  if (status === 'mapped') return 'bg-blue-100 text-blue-800 border-blue-200';
  return 'bg-zinc-100 text-zinc-700 border-zinc-200';
};

export const MappingReview = ({
  mapping,
  onTargetChange,
  onValidate,
  disabled = false,
}) => {
  return (
    <section className="mt-6 rounded-xl border border-deep-violet-blue/20 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif text-xl text-deep-violet-blue">Generated Mapping Review</h2>
          <p className="text-sm text-deep-violet-blue/80">
            File: <span className="font-medium">{mapping.filename}</span>
          </p>
        </div>
        <div className="text-sm text-deep-violet-blue/80">
          ID: <span className="font-mono">{mapping.mappingId}</span>
        </div>
      </div>

      {mapping.requiredMissing.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Missing required target fields: {mapping.requiredMissing.join(', ')}
        </div>
      )}

      {mapping.unmapped.length > 0 && (
        <div className="mb-4 rounded-lg border border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-800">
          Unmapped source columns: {mapping.unmapped.join(', ')}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-zinc-700">Source Column</th>
              <th className="px-3 py-2 text-left font-semibold text-zinc-700">Suggested Target</th>
              <th className="px-3 py-2 text-left font-semibold text-zinc-700">Confidence</th>
              <th className="px-3 py-2 text-left font-semibold text-zinc-700">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {mapping.suggestions.map((row, index) => (
                <tr key={`${mapping.mappingId}-${row.sourceColumn}`}>
                  <td className="px-3 py-2 text-zinc-900">{row.sourceColumn}</td>
                  <td className="px-3 py-2">
                    <select
                      value={row.targetField}
                      onChange={(event) => onTargetChange(mapping.mappingId, index, event.target.value)}
                      disabled={disabled}
                      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-deep-violet-blue focus:outline-none"
                    >
                      <option value="">Select target field</option>
                      {TARGET_FIELD_OPTIONS.filter((option) => option).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClassForConfidence(
                        row.confidence,
                      )}`}
                    >
                      {Math.round(row.confidence * 100)}%
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClassForStatus(
                        row.status,
                      )}`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-deep-violet-blue/80">
          {mapping.validated
            ? `Validated${mapping.validatedAt ? ` at ${new Date(mapping.validatedAt).toLocaleString()}` : ''}`
            : 'Review and adjust target fields before validating.'}
        </p>
        <button
          type="button"
          onClick={() => onValidate(mapping.mappingId)}
          disabled={disabled || mapping.validated}
          className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mapping.validated ? 'Mapping Validated' : 'Validate Mapping'}
        </button>
      </div>
    </section>
  );
};