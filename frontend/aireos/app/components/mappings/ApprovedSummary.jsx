import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Upload } from 'lucide-react';

import Disclosure from '@/components/ui/Disclosure';
import { retailerLabel } from '@/app/utils/retailerLabel';
import { cn } from '@/lib/utils';

const action =
  'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue focus-visible:ring-offset-2';
const primary = `${action} border-deep-violet-blue bg-deep-violet-blue text-white hover:opacity-90`;
const secondary = `${action} border-deep-violet-blue/30 bg-white text-deep-violet-blue hover:bg-cream`;

function fileName(path) {
  return String(path || '').split('/').pop();
}

function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** One number and what it counts, in a tile. */
function Stat({ value, label, tone = 'default' }) {
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2',
        tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-lavander bg-cream/40',
      )}
    >
      <p className={cn('text-lg font-semibold', tone === 'warning' ? 'text-amber-900' : 'text-deep-violet-blue')}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-deep-violet-blue/70">{label}</p>
    </div>
  );
}

/**
 * What approving did, in the reviewer's terms, the way a payment or import
 * "done" screen reads: a headline, what happens from now on, the results as
 * numbers (uploads imported, sales rows added, rows skipped), anything that
 * went wrong with what to do about it, and the next places to go. Where the
 * contract was stored in the bucket is kept for whoever needs it, folded away.
 *
 * @param {{ approved: object }} props
 */
export default function ApprovedSummary({ approved }) {
  const processing = approved.processing || [];
  const imported = processing.filter((item) => item.success);
  const failed = processing.filter((item) => !item.success);
  const rowsAdded = imported.reduce((total, item) => total + (item.processing?.rows_stored || 0), 0);
  const rowsSkipped = imported.reduce((total, item) => total + (item.processing?.rows_rejected || 0), 0);
  const skippedReasons = imported.map((item) => item.processing?.rejection_summary).filter(Boolean);
  // Loading into Cloud SQL can be switched off (local development): the
  // files were read, but nothing was saved.
  const storageOff = imported.some((item) => item.processing?.storage_status === 'disabled');
  const customer = retailerLabel(approved.customer_name || approved.vendor);

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
            From now on, files with these columns import automatically — no review needed.
          </p>
        </div>
      </div>

      {processing.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Stat value={imported.length} label={`Waiting upload${imported.length === 1 ? '' : 's'} imported`} />
          <Stat value={rowsAdded} label="Sales rows added" />
          {rowsSkipped > 0 ? (
            <Stat value={rowsSkipped} label="Rows skipped" tone="warning" />
          ) : (
            <Stat value={failed.length} label="Uploads that failed" tone={failed.length ? 'warning' : 'default'} />
          )}
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-lavander bg-cream/40 px-3 py-2 text-sm text-deep-violet-blue/80">
          No uploads were waiting on this mapping. Upload a file with these columns to add its sales.
        </p>
      )}

      {storageOff && (
        <p className="mt-2 text-xs text-amber-900">
          Loading into the database is switched off here, so the files were read but no sales were saved.
        </p>
      )}

      {rowsSkipped > 0 && skippedReasons.length > 0 && (
        <p className="mt-2 text-xs text-amber-900">Skipped rows: {skippedReasons.join(' ')}</p>
      )}

      {failed.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
            {plural(failed.length, 'upload', 'uploads')} could not be imported
          </p>
          <ul className="mt-1 space-y-1 pl-5.5 text-xs">
            {failed.map((item) => (
              <li key={item.blob_path}>
                <span className="font-mono">{fileName(item.blob_path)}</span> — {item.error}
              </li>
            ))}
          </ul>
          <p className="mt-2 pl-5.5 text-xs">The mapping is saved. Fix the file and upload it again.</p>
        </div>
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
        <Link href="/upload" className={primary}>
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
    </section>
  );
}
