'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Database, RefreshCw, Upload } from 'lucide-react';

import Disclosure from '@/components/ui/Disclosure';
import LoadConfirmDialog from '@/components/upload/LoadConfirmDialog';
import { formatDateTime } from '@/lib/formatDate';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { wasSaved } from '@/app/utils/loadPreview';
import { filesLabel } from '@/app/utils/uploadFlow';
import { cn } from '@/lib/utils';

const action =
  'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue focus-visible:ring-offset-2';
const primary = `${action} border-deep-violet-blue bg-deep-violet-blue text-white hover:opacity-90`;
const secondary = `${action} border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream`;
// Leaving the page while a load is waiting: available, but never a peer of the load button.
const quiet =
  'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-deep-violet-blue/70 underline-offset-2 hover:text-deep-violet-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue';

function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** Which version a file's sales data came from; unknown for loads made before versions were recorded. */
function loadedWith(file) {
  return file.loaded_version ? `Loaded with v${file.loaded_version}` : 'Loaded with an earlier version';
}

/**
 * Files the approved mapping can load, with the one button that opens the
 * load confirmation for all of them. `detail` is the line on each file's right.
 */
function LoadableFiles({ title, help, files, detail, buttonLabel, Icon, onLoad }) {
  return (
    <div className="rounded-md border border-deep-violet-blue/20 border-l-4 border-l-deep-violet-blue bg-cream/40 p-3">
      <p className="text-sm font-medium text-deep-violet-blue">{title}</p>
      <p className="mt-0.5 text-xs text-deep-violet-blue/75">{help}</p>
      <ul className="mt-2 space-y-0.5 text-xs text-deep-violet-blue">
        {files.map((file) => (
          <li key={file.blob_path} className="flex justify-between gap-x-3">
            <span className="min-w-0 truncate font-mono" title={file.filename}>
              {file.filename}
            </span>
            <span className="shrink-0 text-deep-violet-blue/70">{detail(file)}</span>
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
 * What approving did, in the reviewer's terms: the new version is live for
 * future uploads, and nothing already uploaded has been loaded with it. That
 * is the next, separate step -- the files waiting on this mapping (and, after
 * a new version, the ones loaded with an older one) are listed with a button
 * that opens the load confirmation (LoadConfirmDialog), because a load cannot
 * be undone and an approval can. Files loaded from here move to their own
 * list rather than disappearing, so the screen shows the step was done.
 *
 * @param {{ approved: object }} props
 */
export default function ApprovedSummary({ approved }) {
  // load_uploads results that wrote to sell-out from this screen.
  const [loadedHere, setLoadedHere] = useState([]);
  const [dialog, setDialog] = useState(null); // null | { blobPaths, reload }

  const loadedPaths = new Set(loadedHere.map((item) => item.blob_path));
  const waiting = (approved.waiting_uploads || []).filter((file) => !loadedPaths.has(file.blob_path));
  const outdated = (approved.outdated_uploads || []).filter((file) => !loadedPaths.has(file.blob_path));
  const customer = retailerLabel(approved.customer_name || approved.vendor);
  const version = approved.version;
  const hasNextStep = waiting.length > 0 || outdated.length > 0;

  function handleLoaded(response) {
    // A check with saving switched off wrote nothing, so the file stays listed as loadable.
    const saved = (response?.results || []).filter(wasSaved);
    setLoadedHere((prev) => [...prev, ...saved]);
  }

  return (
    <section className="rounded-lg border border-lavander bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-7 shrink-0 text-green-600" />
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 font-serif text-xl text-deep-violet-blue">
            Nomenclature approved
            <span className="rounded-full border border-lavander bg-cream px-2 py-0.5 font-sans text-xs font-medium">
              v{version}
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-deep-violet-blue/75">
            {approved.name} · {customer}
            {version > 1 && ` · replaces v${version - 1}`}
          </p>
          <p className="mt-2 text-sm text-deep-violet-blue">
            Version {version} is now live.{' '}
            {approved.load_requires_confirmation
              ? 'New uploads with these columns are matched to it and wait for you to load them.'
              : 'New uploads with these columns load with it as soon as they are uploaded.'}
          </p>
        </div>
      </div>

      {hasNextStep && (
        <div className="mt-5 space-y-3">
          <p className="text-sm font-medium text-deep-violet-blue">Next step: load the sales data</p>

          {waiting.length > 0 && (
            <LoadableFiles
              title={`${plural(waiting.length, 'file is', 'files are')} waiting to load`}
              help={`Uploaded before this nomenclature was approved, so nothing from ${waiting.length === 1 ? 'it' : 'them'} is in sales data yet. You'll see what loading changes before anything is written.`}
              files={waiting}
              detail={(file) => `Uploaded ${formatDateTime(file.uploaded_at)}`}
              buttonLabel={`Review and load ${filesLabel(waiting.length)}`}
              Icon={Database}
              onLoad={() => setDialog({ blobPaths: waiting.map((file) => file.blob_path), reload: false })}
            />
          )}

          {outdated.length > 0 && (
            <LoadableFiles
              title={`${plural(outdated.length, 'file was', 'files were')} loaded with an older version`}
              help={`The dashboard still shows what the older version read from ${outdated.length === 1 ? 'it' : 'them'}. Reloading replaces those figures with what version ${version} reads.`}
              files={outdated}
              detail={(file) => `${loadedWith(file)} · uploaded ${formatDateTime(file.uploaded_at)}`}
              buttonLabel={`Reload ${filesLabel(outdated.length)} with v${version}`}
              Icon={RefreshCw}
              onLoad={() => setDialog({ blobPaths: outdated.map((file) => file.blob_path), reload: true })}
            />
          )}
        </div>
      )}

      {loadedHere.length > 0 && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-green-900">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-green-600" />
            {plural(loadedHere.length, 'file', 'files')} loaded with v{version}
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-5.5 text-xs">
            {loadedHere.map((item) => (
              <li key={item.blob_path} className="flex justify-between gap-x-3">
                <span className="min-w-0 truncate font-mono" title={item.filename}>
                  {item.filename}
                </span>
                <span className="shrink-0">{plural(item.processing?.rows_stored || 0, 'sales row', 'sales rows')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasNextStep && !loadedHere.length && (
        <p className="mt-4 rounded-md border border-lavander bg-cream/40 px-3 py-2 text-sm text-deep-violet-blue/80">
          No uploads are waiting on this nomenclature. Upload a file with these columns to add its sales.
        </p>
      )}

      {!!approved.warnings?.length && (
        <Disclosure
          className="mt-3 rounded-md border border-amber-200 bg-amber-50"
          summary={<span className="text-amber-900">{plural(approved.warnings.length, 'note', 'notes')} on the nomenclature</span>}
        >
          <ul className="list-disc space-y-1 border-t border-amber-200 px-3 py-2 pl-7 text-xs text-amber-900">
            {approved.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Disclosure>
      )}

      {/* "Back to Mappings" sits in the page header (mappings/[id]/page.js).
          The dashboard is offered only once a load from here wrote rows:
          approving alone changes nothing it shows. */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link href="/upload" className={hasNextStep ? quiet : loadedHere.length ? secondary : primary}>
          <Upload aria-hidden="true" className="size-4" />
          Upload more files
        </Link>
        {loadedHere.length > 0 && (
          <Link href="/dashboard" className={hasNextStep ? secondary : primary}>
            View Sales Dashboard
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        )}
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
