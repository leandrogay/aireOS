'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, RotateCw, X } from 'lucide-react';

import { formatDateTime } from '@/lib/formatDate';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import DuplicateChoice from '@/components/upload/DuplicateChoice';
import UploadPreview from '@/components/upload/UploadPreview';
import { formatFileSize, getFileExtension } from '@/app/utils/fileInspect';
import { STAGES, fileKind } from '@/app/utils/uploadFlow';

const action =
  'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60';
const secondaryAction = `${action} border-violet bg-white text-deep-violet-blue hover:bg-lavander`;
const primaryAction = `${action} border-deep-violet-blue bg-deep-violet-blue text-white hover:opacity-90`;

// Before upload the cross means "leave this file out"; after, it only tidies
// the list (the upload itself is kept, and listed under Recent uploads).
const BEFORE_UPLOAD = new Set(['checking', 'ready', 'near_match', 'new_layout', 'unchecked', 'duplicate']);

function MappingName({ name, vendor }) {
  return (
    <>
      <span className="font-medium">{name || 'a saved mapping'}</span>
      {vendor && <> · {vendor}</>}
    </>
  );
}

/**
 * The upload's server-side steps as a segmented bar. The steps are real; only
 * their timing is a guess (see STAGES), so there is no percentage to show.
 */
function UploadProgress({ stage }) {
  const current = Math.max(0, STAGES.findIndex((entry) => entry.key === stage));

  return (
    <div className="mt-2 max-w-sm">
      <div className="flex gap-1" aria-hidden="true">
        {STAGES.map((entry, index) => (
          <span
            key={entry.key}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              index < current && 'bg-deep-violet-blue',
              index === current && 'animate-pulse bg-violet motion-reduce:animate-none',
              index > current && 'bg-lavander',
            )}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-deep-violet-blue/70">
        Uploading, step {current + 1} of {STAGES.length}: {STAGES[current].label.toLowerCase()}…
      </p>
    </div>
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
 *   onDecide: (id: string, decision: 'replace' | 'keep') => void,
 * }} props
 */
export default function UploadFileRow({ item, onRemove, onRetry, onDecide }) {
  const [showPreview, setShowPreview] = useState(false);
  const { id, file, check, outcome } = item;
  const kind = fileKind(item);
  const extension = getFileExtension(file.name);
  const processing = kind === 'uploaded' ? outcome.processing : null;
  const hasPreview = Boolean(processing?.preview?.length);
  const beforeUpload = BEFORE_UPLOAD.has(kind);

  return (
    <li className="rounded-lg border border-lavander bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-deep-violet-blue" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-deep-violet-blue/60">
            {extension ? `.${extension} · ` : ''}
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
                value={item.decision}
                onChange={(decision) => onDecide(id, decision)}
              />
            </>
          )}

          {kind === 'uploading' && <UploadProgress stage={item.stage} />}

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
                  Preview only: loading into Cloud SQL is turned off.
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
                    View mapping
                  </Link>
                )}
              </div>
            </>
          )}

          {kind === 'needs_review' && (
            <>
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
                      className={secondaryAction}
                      aria-label={`View the closest mapping for ${file.name}`}
                    >
                      View closest mapping
                    </Link>
                  ) : (
                    <Link
                      href={`/mappings/${outcome.mappingId}`}
                      className={primaryAction}
                      aria-label={`Review the suggested mapping for ${file.name}`}
                    >
                      Review mapping
                    </Link>
                  )}
                </div>
              )}
            </>
          )}

          {kind === 'failed' && (
            <>
              <p className="mt-1 text-xs text-red-700">{outcome.error}</p>
              <button
                type="button"
                onClick={() => onRetry(id)}
                className={cn(secondaryAction, 'mt-2')}
              >
                <RotateCw aria-hidden="true" className="size-3.5" />
                Try again
              </button>
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
            className="shrink-0 text-deep-violet-blue/60 hover:bg-lavander hover:text-deep-violet-blue"
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>

      {showPreview && hasPreview && <UploadPreview processing={processing} />}
    </li>
  );
}
