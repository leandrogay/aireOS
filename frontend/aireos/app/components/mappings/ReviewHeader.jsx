import { AlertTriangle, FileSpreadsheet, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateTime } from '@/lib/formatDate';
import { mappingTitle } from '@/app/utils/mappingList';
import { PROPOSER, proposedByLabel } from '@/app/utils/mappingReview';
import { customerLabel, vendorLabel } from '@/app/utils/retailerLabel';

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
  const customer = mapping.customerName ? customerLabel(mapping.customerName) : vendorLabel(mapping.vendor);
  const model = proposedByLabel(mapping.proposedBy);
  const file = mapping.sourceFilename || String(mapping.filename || '').split('/').pop();
  // Packet aiUnavailable: the model was retired when this file was uploaded, so
  // the proposal starts blank (backend generate_mapping.blank_mapping_contract).
  const byHand = !isConfirmed && Boolean(mapping.aiUnavailable);
  const proposedBy = byHand ? ' · to fill in by hand' : ` · proposed by ${PROPOSER}${model ? ` (${model})` : ''}`;

  return (
    <section className="aire-card p-4">
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
            {customer && <span className="font-normal text-deep-violet-blue/70"> · {customer}</span>}
          </h2>
          {file && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-deep-violet-blue/60" title={mapping.filename || undefined}>
              <FileSpreadsheet aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">
                {file}
                {!isConfirmed && proposedBy}
                {mapping.validatedAt && ` · approved ${formatDateTime(mapping.validatedAt)}`}
              </span>
            </p>
          )}
        </div>

        {/* Apart from the save flow: discarding throws the whole proposal away. */}
        {canDiscard && (
          <Button type="button" variant="destructive-outline" size="sm" onClick={onDiscard} disabled={busy !== null}>
            <Trash2 aria-hidden="true" />
            Discard proposal
          </Button>
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

      {byHand && (
        // Amber like ModelUnavailableNotice: the reviewer has extra work to do.
        // The fix (a setting) is for whoever deploys, so it sits behind the icon.
        <p role="status" className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-amber-700" />
          <span>
            AI was unavailable when this file was uploaded, so the fields start blank. Choose where each one comes from below.
          </span>
          <InfoTooltip label="Why AI was unavailable">{mapping.aiUnavailable}</InfoTooltip>
        </p>
      )}

      {discardError && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {discardError}
        </p>
      )}
    </section>
  );
}
