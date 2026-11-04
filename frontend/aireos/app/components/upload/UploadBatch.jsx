'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { formatDateTime } from '@/lib/formatDate';
import { cn } from '@/lib/utils';
import UploadGroup from '@/components/upload/UploadGroup';

// Sections that fold away in an earlier batch: uploaded, or skipped as a
// duplicate. Nothing in them asks anything of the person.
const SETTLED = ['uploaded', 'skipped'];

/**
 * The results of one Upload press: when it was sent, a one-line summary, then
 * its files by outcome, what needs the person first. Like a cloud drive's
 * upload panel, the newest batch is open and earlier ones fold away the files
 * that went through -- but a file that still needs something (failed, to
 * review, to load) always shows, however old its batch.
 *
 * @param {{
 *   batch: { id: string, startedAt: string, groups: object[], summary: string },
 *   isLatest: boolean,
 *   onRemove: (id: string) => void,
 *   onRetry: (id: string) => void,
 *   onDecide: (id: string, decision: 'replace' | 'keep' | 'skip') => void,
 *   onLoad: (ids: string[]) => void,
 * }} props
 */
export default function UploadBatch({ batch, isLatest, onRemove, onRetry, onDecide, onLoad }) {
  // Null follows the batch's place: open while latest, folded once a newer
  // one arrives. A click overrides that either way.
  const [openOverride, setOpenOverride] = useState(null);
  const open = openOverride ?? isLatest;

  // Files with nothing left to do; everything else always shows.
  const settled = batch.groups.filter((group) => SETTLED.includes(group.key));
  const settledCount = settled.reduce((count, group) => count + group.items.length, 0);
  const shown = batch.groups.filter((group) => open || !SETTLED.includes(group.key));
  const headingId = `${batch.id}-heading`;

  return (
    <section aria-labelledby={headingId} className="border-t border-lavander pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-sm font-medium text-deep-violet-blue">
          Sent {formatDateTime(batch.startedAt)}
          {isLatest && (
            <span className="ml-2 rounded-full bg-lavander px-2 py-0.5 text-[11px] font-medium text-deep-violet-blue">
              Latest
            </span>
          )}
        </h3>
        <p aria-live="polite" className="text-xs text-deep-violet-blue/70 tabular-nums">
          {batch.summary}
        </p>
      </div>

      {shown.map((group) => (
        <UploadGroup
          key={group.key}
          group={group}
          idPrefix={batch.id}
          onRemove={onRemove}
          onRetry={onRetry}
          onDecide={onDecide}
          onLoad={onLoad}
        />
      ))}

      {settledCount > 0 && (
        <button
          type="button"
          onClick={() => setOpenOverride(!open)}
          aria-expanded={open}
          className="mt-3 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-deep-violet-blue/70 hover:bg-lavander hover:text-deep-violet-blue"
        >
          <ChevronRight aria-hidden="true" className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          {open
            ? 'Hide completed files'
            : `Show ${settledCount} completed file${settledCount === 1 ? '' : 's'}`}
        </button>
      )}
    </section>
  );
}
