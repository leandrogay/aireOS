'use client';

import StatusBadge from '../ui/StatusBadge';

// Mapping state as something a person reads. Anything unrecognised falls
// through to the raw value rather than being hidden.
const STATE_LABELS = {
  builtin: { tone: 'neutral', label: 'Built-in' },
  confirmed: { tone: 'ready', label: 'Confirmed' },
  pending: { tone: 'review', label: 'Needs review' },
};

// One line on what, if anything, stops this mapping being used as-is.
function issueSummary(mapping) {
  const missing = mapping.requiredMissing?.length || 0;
  const warnings = mapping.warnings?.length || 0;

  if (missing) return `${missing} required field${missing === 1 ? '' : 's'} missing`;
  if (warnings) return `${warnings} warning${warnings === 1 ? '' : 's'}`;
  return null;
}

/**
 * One row per stored mapping. Clicking a row opens it for review; the rules
 * themselves are only shown there, so this list stays short.
 *
 * @param {{ mappings: object[], onOpen: (mappingId: string) => void }} props
 */
export default function MappingSummaryTable({ mappings, onOpen }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-lavander bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-lavander text-deep-violet-blue">
          <tr>
            <th className="px-3 py-2 font-medium">Mapping</th>
            <th className="px-3 py-2 font-medium">Vendor</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Issues</th>
          </tr>
        </thead>
        <tbody className="text-deep-violet-blue">
          {mappings.map((mapping) => {
            const state = STATE_LABELS[mapping.state];
            const issues = issueSummary(mapping);

            return (
              <tr
                key={mapping.mappingId}
                onClick={() => onOpen(mapping.mappingId)}
                className="cursor-pointer border-t border-lavander transition hover:bg-cream"
              >
                <td className="max-w-[18rem] px-3 py-2">
                  {/* The button is the keyboard route in; the row click is
                      the same action for a mouse. */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(mapping.mappingId);
                    }}
                    className="block max-w-full truncate text-left font-medium underline-offset-2 hover:underline"
                    title={mapping.name || mapping.mappingId}
                  >
                    {mapping.name || 'Unnamed mapping'}
                  </button>
                  {mapping.filename && (
                    <p className="truncate text-xs text-deep-violet-blue/60" title={mapping.filename}>
                      {mapping.filename}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">{mapping.vendor || mapping.retailerFamily || '—'}</td>
                <td className="px-3 py-2">
                  {state ? (
                    <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">{mapping.state || 'Unknown'}</StatusBadge>
                  )}
                </td>
                <td className="px-3 py-2">
                  {issues ? (
                    <span className="text-amber-900">{issues}</span>
                  ) : (
                    <span className="text-deep-violet-blue/60">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
