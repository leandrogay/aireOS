'use client';

import Link from 'next/link';
import { formatDateTime } from '@/lib/formatDate';

const btn =
  'rounded-md border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60';

const STATE_LABEL = {
  confirmed: 'Confirmed mapping',
  pending: 'Proposed mapping',
};

function describeTransform(transform) {
  if (!transform) return null;
  if (typeof transform === 'string') return transform;
  if (transform.type === 'regex_extract') {
    return `Extract group ${transform.group || 1} from /${transform.pattern || ''}/`;
  }
  if (transform.type === 'value_map') {
    const count = Object.keys(transform.values || {}).length;
    return `Map ${count} source value${count === 1 ? '' : 's'}${
      Object.hasOwn(transform, 'default') ? '; use a default for the rest' : ''
    }`;
  }
  return transform.type || 'Transformed';
}

// A read-only summary of a mapping's rules. Every change — editing, approving,
// discarding — happens on the full review page (/mappings/[id]), which alone
// can show samples and confidence, preview the output, and collect the name
// and vendor a first approval needs.
export const MappingReview = ({ mapping }) => {
  const isPending = mapping.state === 'pending';

  return (
    <section className="rounded-lg border border-lavander bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 inline-flex rounded-full border border-deep-violet-blue/20 bg-lavander px-3 py-1 text-xs font-semibold uppercase tracking-wide text-deep-violet-blue">
            {STATE_LABEL[mapping.state] || mapping.state}
          </div>
          <h2 className="font-serif text-xl text-deep-violet-blue">
            {mapping.name || 'Unnamed mapping'}
          </h2>
          {mapping.vendor && (
            <p className="text-sm text-deep-violet-blue/80">
              Vendor: <span className="font-medium">{mapping.vendor}</span>
            </p>
          )}
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
                  {rule.sourceColumn ? (
                    <span className="text-zinc-900">{rule.sourceColumn}</span>
                  ) : (
                    <span className="text-zinc-400">No source</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {describeTransform(rule.transform) ? (
                    <span className="text-zinc-700">{describeTransform(rule.transform)}</span>
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
              ? `Confirmed${mapping.validatedAt ? ` on ${formatDateTime(mapping.validatedAt)}` : ''}`
              : 'Not yet confirmed.'}
        </p>

        <div className="flex items-center gap-3">
          <Link
            href={`/mappings/${mapping.mappingId}`}
            className={`${btn} border-deep-violet-blue bg-deep-violet-blue text-white hover:opacity-90`}
          >
            {isPending
              ? 'Review and approve'
              : mapping.editable === false
                ? 'Open full review'
                : 'Review and edit'}
          </Link>
        </div>
      </div>
    </section>
  );
};
