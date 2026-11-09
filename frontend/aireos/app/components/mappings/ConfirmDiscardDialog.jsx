'use client';

import { AlertTriangle, FileSpreadsheet } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDate } from '@/lib/formatDate';

/**
 * Confirm before DELETE /api/mappings/{fp}/pending so one click cannot throw
 * away a proposal. Discarding also deletes the uploaded files waiting on it
 * (`mapping.waitingUploads`, from the review packet), so they are named here.
 * Mirrors the promotions ConfirmDeleteDialog: Cancel never hits the API, and
 * the dialog cannot be dismissed while the request is in flight.
 *
 * @param {{
 *   mapping: object | null,
 *   isDiscarding: boolean,
 *   onCancel: () => void,
 *   onConfirm: () => void,
 * }} props
 */
export default function ConfirmDiscardDialog({ mapping, isDiscarding, onCancel, onConfirm }) {
  // The stored filename is a full gs://bucket/uploads/... path. The bucket and
  // folder are the same for every upload, so only the last segment tells the
  // reviewer which file this is; the full path stays in the tooltip.
  const source = mapping?.filename || '';
  const fileLabel = mapping?.name || source.split('/').pop() || 'this file layout';
  const waitingUploads = mapping?.waitingUploads || [];
  const fileCount = waitingUploads.length;

  return (
    <Dialog
      open={!!mapping}
      onOpenChange={(open) => {
        if (!open && !isDiscarding) onCancel();
      }}
    >
      {/* The primitive's grid sizes its column to the longest unbreakable word,
          and a filename has no spaces — wrap-anywhere lets it break so the
          text and buttons stay inside the modal. */}
      <DialogContent
        showCloseButton={false}
        className="gap-4 border border-lavander bg-white wrap-anywhere sm:max-w-md"
      >
        <div className="space-y-1.5">
          <DialogTitle className="font-serif text-lg text-deep-violet-blue">
            Discard this proposal?
          </DialogTitle>
          <DialogDescription className="text-sm text-deep-violet-blue/80">
            {fileCount
              ? 'These uploaded files are waiting on it and will be removed too:'
              : 'The next file with this layout will get a fresh proposal.'}
          </DialogDescription>
        </div>

        {fileCount ? (
          <>
            <ul className="space-y-1.5">
              {waitingUploads.map((upload) => (
                <li
                  key={upload.blob_path}
                  className="flex items-start gap-2 rounded-md border border-lavander bg-cream px-3 py-2"
                  title={upload.blob_path}
                >
                  <FileSpreadsheet aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-deep-violet-blue/80" />
                  <span className="min-w-0 flex-1 line-clamp-2 font-mono text-xs leading-5 text-deep-violet-blue">
                    {upload.filename}
                  </span>
                  {upload.uploaded_at && (
                    <span className="shrink-0 text-xs leading-5 text-deep-violet-blue/80">
                      {formatDate(upload.uploaded_at)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-sm text-deep-violet-blue/80">
              Nothing was loaded from {fileCount === 1 ? 'it' : 'them'}, so no sales data changes. To try
              again, upload {fileCount === 1 ? 'the file' : 'the files'} again.
            </p>
          </>
        ) : (
          <div
            className="flex items-start gap-2 rounded-md border border-lavander bg-cream px-3 py-2"
            title={source || undefined}
          >
            <FileSpreadsheet aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-deep-violet-blue/80" />
            <span className="line-clamp-2 font-mono text-xs leading-5 text-deep-violet-blue">
              {fileLabel}
            </span>
          </div>
        )}

        <p className="flex items-center gap-2 text-sm font-medium text-red-700">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          This cannot be undone.
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDiscarding}
            className="rounded-md border border-deep-violet-blue/30 bg-white px-3 py-1.5 text-sm font-medium text-deep-violet-blue hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDiscarding}
            className="rounded-md border border-red-700 bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDiscarding ? 'Discarding…' : 'Confirm discard'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
