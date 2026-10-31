import { FileSpreadsheet, Trash2 } from 'lucide-react';

import InfoTooltip from '@/components/ui/InfoTooltip';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateTime } from '@/lib/formatDate';
import { mappingTitle } from '@/app/utils/mappingList';
import { PROPOSER, proposedByLabel } from '@/app/utils/mappingReview';
import { retailerLabel } from '@/app/utils/retailerLabel';

const destructive =
  'inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The top of the review: what this mapping is, what state it is in, and in a
 * sentence or two what the reviewer is being asked to do. A proposal and a
 * live mapping read differently, because changing a live one changes every
 * future upload of its layout.
 *
 * @param {{
 *   mapping: object,
 *   changed: boolean,
 *   canDiscard: boolean,
 *   busy: string | null,
 *   discardError: string,
 *   onDiscard: () => void,
 * }} props
 */
export default function ReviewHeader({ mapping, changed, canDiscard, busy, discardError, onDiscard }) {
  const isConfirmed = mapping.state === 'confirmed';
  const customer = mapping.customerName || mapping.vendor;
  const model = proposedByLabel(mapping.proposedBy);
  const file = mapping.sourceFilename || String(mapping.filename || '').split('/').pop();

  return (
    <section className="rounded-lg border border-lavander bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={isConfirmed ? 'ready' : 'review'}>
              {isConfirmed ? `Live · version ${mapping.version || 1}` : 'Waiting for approval'}
            </StatusBadge>
            {changed && <StatusBadge tone="neutral">Unsaved changes</StatusBadge>}
          </div>
          <h2 className="mt-2 text-sm font-medium text-deep-violet-blue">
            {mappingTitle(mapping)}
            {customer && <span className="font-normal text-deep-violet-blue/70"> · {retailerLabel(customer)}</span>}
          </h2>
          {file && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-deep-violet-blue/60" title={mapping.filename || undefined}>
              <FileSpreadsheet aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">
                {file}
                {!isConfirmed && ` · proposed by ${PROPOSER}${model ? ` (${model})` : ''}`}
                {mapping.validatedAt && ` · approved ${formatDateTime(mapping.validatedAt)}`}
              </span>
            </p>
          )}
        </div>

        {/* Apart from the save flow: discarding throws the whole proposal away. */}
        {canDiscard && (
          <button type="button" onClick={onDiscard} disabled={busy !== null} className={destructive}>
            <Trash2 aria-hidden="true" className="size-3.5" />
            Discard proposal
          </button>
        )}
      </div>

      {/* One line; the why is behind the icon for whoever wants it. */}
      <p className="mt-2 flex items-center gap-1 text-sm text-deep-violet-blue">
        {isConfirmed ? 'In use for every file with these columns.' : 'Check each step, then approve.'}
        <InfoTooltip label="About this nomenclature">
          {isConfirmed
            ? 'Saving creates a new version. Files already uploaded with these columns are imported again using it.'
            : 'Approving saves this nomenclature. Files with the same columns are then imported automatically, with no review. Any waiting uploads are imported now.'}
        </InfoTooltip>
      </p>

      {discardError && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {discardError}
        </p>
      )}
    </section>
  );
}
