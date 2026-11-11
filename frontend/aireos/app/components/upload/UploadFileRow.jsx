'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Database, RotateCw, X } from 'lucide-react';

import { formatDateTime } from '@/lib/formatDate';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import DuplicateChoice from '@/components/upload/DuplicateChoice';
import UploadProgress from '@/components/upload/UploadProgress';
import UploadPreview from '@/components/upload/UploadPreview';
import { fileTypeLabel, formatFileSize } from '@/app/utils/fileInspect';
import { duplicateDecision, duplicateResult, fileKind } from '@/app/utils/uploadFlow';
import { vendorLabel } from '@/app/utils/retailerLabel';

// The row's actions are the shared Button. The two that navigate are links, so
// they take its look through buttonVariants instead of nesting a <button>.
const primaryLink = buttonVariants({ size: 'sm' });
const secondaryLink = buttonVariants({ variant: 'outline', size: 'sm' });

// Before upload the cross means "leave this file out"; after, it only tidies
// the list (the upload itself is kept, and listed under Recent uploads).
const BEFORE_UPLOAD = new Set(['checking', 'ready', 'near_match', 'new_layout', 'unchecked', 'duplicate']);

function MappingName({ name, vendor }) {
  return (
    <>
      <span className="font-medium">{name || 'a saved nomenclature'}</span>
      {vendor && <> · {vendorLabel(vendor)}</>}
    </>
  );
}

/**
 * What exactly matched the earlier upload. The section heading already says
 * "Already uploaded", so this only adds what is particular to this file. A
 * name match does not prove the contents differ: uploads from before content
 * hashing match by name only (backend find_existing_upload), so it says no
 * more than "same name".
 */
function DuplicateNote({ duplicate, fileName }) {
  const otherName =
    duplicate.existingFilename && duplicate.existingFilename !== fileName
      ? duplicate.existingFilename
      : null;
  const when = duplicate.uploadedAt ? `, uploaded ${formatDateTime(duplicate.uploadedAt)}` : '';

  if (duplicate.matchedOn !== 'content') {
    return duplicate.uploadedAt ? (
      <>Same name as a file uploaded {formatDateTime(duplicate.uploadedAt)}.</>
    ) : (
      <>Same name as an earlier upload.</>
    );
  }
  if (otherName) {
    return (
      <>
        Same contents as <span className="font-medium">{otherName}</span>
        {when}.
      </>
    );
  }
  return <>Exact copy{when}.</>;
}

/**
 * One file in the upload list, from the moment it is dropped to its result.
 * The section it sits in (see groupFiles) says what state it is in and what
 * that means, so the row only carries what is particular to this file, plus
 * its remove control, centred on the right.
 *
 * @param {{
 *   item: object,
 *   onRemove: (id: string) => void,
 *   onRetry: (id: string) => void,
 *   onDecide: (id: string, decision: 'replace' | 'keep' | 'skip') => void,
 *   onLoad: (ids: string[]) => void,
 * }} props
 */
export default function UploadFileRow({ item, onRemove, onRetry, onDecide, onLoad }) {
  const [showPreview, setShowPreview] = useState(false);
  const { id, file, check, outcome } = item;
  const kind = fileKind(item);
  const fileType = fileTypeLabel(file.name);
  const processing = kind === 'uploaded' ? outcome.processing : null;
  const hasPreview = Boolean(processing?.preview?.length);
  const beforeUpload = BEFORE_UPLOAD.has(kind);

  return (
    <li className="aire-card px-4 py-3">
      {/* Top-aligned, so the remove cross stays in the card's top-right corner
          however tall the row grows (duplicate choice, mapping notes). */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-deep-violet-blue" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-deep-violet-blue/60">
            {fileType ? `${fileType} · ` : ''}
            {formatFileSize(file.size)}
          </p>

          {kind === 'ready' && (
            <p className="mt-1 text-xs text-deep-violet-blue">
              Uses <MappingName name={check.mapping.name} vendor={check.mapping.vendor} />
            </p>
          )}

          {kind === 'near_match' && (
            <p className="mt-1 text-xs text-deep-violet-blue">
              Closest:{' '}
              <MappingName name={check.mapping.matched?.name} vendor={check.mapping.matched?.vendor} />
            </p>
          )}

          {kind === 'duplicate' && (
            <>
              <p className="mt-1 text-xs text-deep-violet-blue">
                <DuplicateNote duplicate={check.duplicate} fileName={file.name} />
              </p>
              <DuplicateChoice
                id={id}
                fileName={file.name}
                value={duplicateDecision(item)}
                result={duplicateResult(item)}
                onChange={(decision) => onDecide(id, decision)}
              />
            </>
          )}

          {kind === 'skipped' && check?.duplicate && (
            <p className="mt-1 text-xs text-deep-violet-blue/70">
              <DuplicateNote duplicate={check.duplicate} fileName={file.name} /> Not uploaded.
            </p>
          )}

          {kind === 'uploading' && (
            <UploadProgress
              sendPercent={item.sendPercent}
              sentAt={item.sentAt}
              finished={item.finished}
              check={item.check}
            />
          )}

          {kind === 'uploaded' && (
            <>
              <p className="mt-1 text-xs text-deep-violet-blue">
                {processing?.storage_status === 'completed' && (
                  <>
                    <span className="font-medium text-green-700">
                      {(processing.rows_stored || 0).toLocaleString()} rows loaded
                    </span>
                    {' · '}
                  </>
                )}
                <MappingName name={outcome.name} vendor={outcome.vendor} />
              </p>
              {processing?.storage_status === 'disabled' && (
                <p className="mt-1 text-xs text-amber-900">
                  Not saved: saving is off in this environment, so nothing was written.
                </p>
              )}
              {processing?.rejection_summary && (
                <p className="mt-1 text-xs text-amber-900">{processing.rejection_summary}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-deep-violet-blue">
                {hasPreview && (
                  <button
                    type="button"
                    aria-expanded={showPreview}
                    onClick={() => setShowPreview((open) => !open)}
                    className="inline-flex items-center gap-1 rounded-md outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={cn('size-3.5 transition-transform', showPreview && 'rotate-90')}
                    />
                    {showPreview ? 'Hide preview' : 'Preview rows'}
                  </button>
                )}
                {outcome.mappingId && (
                  <Link
                    href={`/mappings/${outcome.mappingId}`}
                    className="rounded-md underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    View nomenclature
                  </Link>
                )}
              </div>
            </>
          )}

          {kind === 'ready_to_load' && (
            <>
              <p className="mt-1 text-xs text-deep-violet-blue">
                <MappingName name={outcome.name} vendor={outcome.vendor} />
                {' · '}
                <span className="text-amber-900">not loaded yet</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Button type="button" size="sm" onClick={() => onLoad([id])}>
                  <Database aria-hidden="true" />
                  Review and load
                </Button>
                {outcome.mappingId && (
                  <Link
                    href={`/mappings/${outcome.mappingId}`}
                    className="rounded-md text-xs font-medium text-deep-violet-blue underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    View nomenclature
                  </Link>
                )}
              </div>
            </>
          )}

          {kind === 'needs_review' && (
            <>
              {outcome.aiUnavailable && (
                <p className="mt-1 text-xs text-amber-900" title={outcome.aiUnavailable}>
                  AI unavailable: fill this nomenclature in by hand.
                </p>
              )}
              {outcome.why === 'partial' && (
                <>
                  <p className="mt-1 text-xs text-deep-violet-blue">
                    Closest:{' '}
                    <MappingName name={outcome.matched?.name} vendor={outcome.matched?.vendor} />
                  </p>
                  {!!outcome.matched?.extra_columns?.length && (
                    <p className="mt-0.5 text-xs text-deep-violet-blue/80">
                      Extra columns: {outcome.matched.extra_columns.join(', ')}
                    </p>
                  )}
                  {!!outcome.matched?.missing_columns?.length && (
                    <p className="mt-0.5 text-xs text-deep-violet-blue/80">
                      Missing columns: {outcome.matched.missing_columns.join(', ')}
                    </p>
                  )}
                </>
              )}
              {/* A new layout's proposal is filed under this file's own
                  fingerprint, so reviewing it is the next step. A near match
                  stores nothing for this file: the link opens the mapping it
                  resembles, which can be looked at but not approved on this
                  file's behalf, so it is not called a review. */}
              {outcome.mappingId && (
                <div className="mt-2">
                  {outcome.why === 'partial' ? (
                    <Link
                      href={`/mappings/${outcome.mappingId}`}
                      className={secondaryLink}
                      aria-label={`View the closest nomenclature for ${file.name}`}
                    >
                      View closest nomenclature
                    </Link>
                  ) : (
                    <Link
                      href={`/mappings/${outcome.mappingId}`}
                      className={primaryLink}
                      aria-label={`Review the suggested nomenclature for ${file.name}`}
                    >
                      Review nomenclature
                    </Link>
                  )}
                </div>
              )}
            </>
          )}

          {kind === 'failed' && (
            <>
              <p className="mt-1 text-xs text-red-700">{outcome.error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => onRetry(id)} className="mt-2">
                <RotateCw aria-hidden="true" />
                Try again
              </Button>
            </>
          )}
        </div>

        {/* Hidden only mid-upload, when the request cannot be taken back.
            Icon-only, so the label names the file for screen readers and the
            tooltip says what the cross does. 32px target. */}
        {kind !== 'uploading' && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemove(id)}
            aria-label={beforeUpload ? `Don't upload ${file.name}` : `Remove ${file.name} from the list`}
            title={beforeUpload ? "Don't upload" : 'Remove from list'}
            className="-mt-1.5 -mr-2 shrink-0 text-deep-violet-blue/60 hover:bg-lavander hover:text-deep-violet-blue"
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>

      {showPreview && hasPreview && <UploadPreview processing={processing} />}
    </li>
  );
}
