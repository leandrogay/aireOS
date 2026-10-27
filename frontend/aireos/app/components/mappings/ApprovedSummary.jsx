'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Database, RefreshCw, Upload } from 'lucide-react';

import Disclosure from '@/components/ui/Disclosure';
import LoadConfirmDialog from '@/components/upload/LoadConfirmDialog';
import { formatDateTime } from '@/lib/formatDate';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

const action =
  'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue focus-visible:ring-offset-2';
const primary = `${action} border-deep-violet-blue bg-deep-violet-blue text-white hover:opacity-90`;
const secondary = `${action} border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream`;

function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/**
 * Files the approved mapping can load, with the one button that opens the
 * load confirmation for all of them.
 */
function LoadableFiles({ title, help, files, buttonLabel, Icon, onLoad }) {
  return (
    <div className="mt-4 rounded-md border border-lavander bg-cream/40 p-3">
      <p className="text-sm font-medium text-deep-violet-blue">{title}</p>
      <p className="mt-0.5 text-xs text-deep-violet-blue/70">{help}</p>
      <ul className="mt-2 space-y-0.5 text-xs text-deep-violet-blue">
        {files.map((file) => (
          <li key={file.blob_path} className="flex flex-wrap justify-between gap-x-3">
            <span className="truncate font-mono">{file.filename}</span>
            <span className="text-deep-violet-blue/60">Uploaded {formatDateTime(file.uploaded_at)}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onLoad} className={cn(primary, 'mt-3')}>
        <Icon aria-hidden="true" className="size-4" />
        {buttonLabel}
      </button>
    </div>
  );
}

/**
 * What approving did, in the reviewer's terms: the mapping is saved, and no
 * sales data has been loaded. Loading is the next, separate step -- the files
 * waiting on this mapping (and, after a new version, the ones loaded with an
 * older one) are listed with a button that opens the load confirmation
 * (LoadConfirmDialog), because a load cannot be undone and an approval can.
 *
 * @param {{ approved: object }} props
 */
export default function ApprovedSummary({ approved }) {
  // Files loaded from this screen drop off its lists.
  const [loadedPaths, setLoadedPaths] = useState(new Set());
  const [dialog, setDialog] = useState(null); // null | { blobPaths, reload }

  const waiting = (approved.waiting_uploads || []).filter((file) => !loadedPaths.has(file.blob_path));
  const outdated = (approved.outdated_uploads || []).filter((file) => !loadedPaths.has(file.blob_path));
  const customer = retailerLabel(approved.customer_name || approved.vendor);
  const loadedHere = loadedPaths.size;

  function handleLoaded(response) {
    const done = (response?.results || []).filter((item) => item.success).map((item) => item.blob_path);
    setLoadedPaths((prev) => new Set([...prev, ...done]));
  }

  return (
    <section className="rounded-lg border border-lavander bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-7 shrink-0 text-green-600" />
        <div className="min-w-0">
          <h2 className="font-serif text-xl text-deep-violet-blue">Mapping approved</h2>
          <p className="mt-0.5 text-sm text-deep-violet-blue/70">
            {approved.name} · {customer} · version {approved.version}
          </p>
          <p className="mt-2 text-sm text-deep-violet-blue">
            {loadedHere
              ? `${plural(loadedHere, 'file', 'files')} loaded into sales data from here.`
              : 'No sales data has been loaded yet.'}{' '}
            {approved.load_requires_confirmation
              ? 'From now on, files with these columns are matched to this mapping and wait for you to load them.'
              : 'From now on, files with these columns load as soon as they are uploaded.'}
          </p>
        </div>
      </div>

      {waiting.length > 0 && (
        <LoadableFiles
          title={`${plural(waiting.length, 'file is', 'files are')} waiting to load`}
          help="They were uploaded before this mapping was approved. Check what loading them would change before it happens."
          files={waiting}
          buttonLabel={`Review and load ${plural(waiting.length, 'file', 'files')}`}
          Icon={Database}
          onLoad={() => setDialog({ blobPaths: waiting.map((file) => file.blob_path), reload: false })}
        />
      )}

      {outdated.length > 0 && (
        <LoadableFiles
          title={`${plural(outdated.length, 'file was', 'files were')} loaded with an older version`}
          help="Their sales data is unchanged. Reloading replaces it with what this version reads from the files."
          files={outdated}
          buttonLabel={`Reload ${plural(outdated.length, 'file', 'files')} with the new version`}
          Icon={RefreshCw}
          onLoad={() => setDialog({ blobPaths: outdated.map((file) => file.blob_path), reload: true })}
        />
      )}

      {!waiting.length && !outdated.length && !loadedHere && (
        <p className="mt-4 rounded-md border border-lavander bg-cream/40 px-3 py-2 text-sm text-deep-violet-blue/80">
          No uploads are waiting on this mapping. Upload a file with these columns to add its sales.
        </p>
      )}

      {!!approved.warnings?.length && (
        <Disclosure
          className="mt-3 rounded-md border border-amber-200 bg-amber-50"
          summary={<span className="text-amber-900">{plural(approved.warnings.length, 'note', 'notes')} on the mapping</span>}
        >
          <ul className="list-disc space-y-1 border-t border-amber-200 px-3 py-2 pl-7 text-xs text-amber-900">
            {approved.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Disclosure>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link href="/upload" className={waiting.length || outdated.length ? secondary : primary}>
          <Upload aria-hidden="true" className="size-4" />
          Upload more files
        </Link>
        <Link href="/dashboard" className={secondary}>
          View Sales Dashboard
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
        <Link
          href="/mappings"
          className="rounded-md px-2 py-1.5 text-sm font-medium text-deep-violet-blue/70 underline-offset-2 hover:text-deep-violet-blue hover:underline"
        >
          All mappings
        </Link>
      </div>

      <Disclosure variant="link" summary="Technical details" className="mt-4 text-xs text-deep-violet-blue/70">
        <p className="mt-1">
          Stored at <span className="font-mono">{approved.moved_to}</span>
          {approved.archived_previous && (
            <>
              ; the version it replaces is kept at <span className="font-mono">{approved.archived_previous}</span>
            </>
          )}
          .
        </p>
        {approved.pending_removed === false && (
          <p className="mt-1 text-amber-900">
            The old proposal could not be deleted from the bucket. The approved copy takes precedence everywhere, but
            it is worth clearing up.
          </p>
        )}
      </Disclosure>

      <LoadConfirmDialog
        open={dialog !== null}
        blobPaths={dialog?.blobPaths || []}
        reload={Boolean(dialog?.reload)}
        onClose={() => setDialog(null)}
        onLoaded={handleLoaded}
      />
    </section>
  );
}
