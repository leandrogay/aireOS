import Link from 'next/link';

import BackLink from '@/components/ui/BackLink';
import Disclosure from '@/components/ui/Disclosure';
import StatusBadge from '@/components/ui/StatusBadge';
import { retailerLabel } from '@/app/utils/retailerLabel';

function fileName(path) {
  return String(path || '').split('/').pop();
}

/**
 * What approving did, in the reviewer's terms: the version now in use, the
 * waiting uploads it processed into sales, and any that failed. Where the
 * contract was moved in the bucket is kept for whoever needs it, folded away.
 *
 * @param {{ approved: object }} props
 */
export default function ApprovedSummary({ approved }) {
  const failed = (approved.processing || []).filter((item) => !item.success);

  return (
    <section className="rounded-lg border border-green-300 bg-green-50 p-3 shadow-sm">
      <StatusBadge tone="ready">Mapping approved</StatusBadge>
      <h2 className="mt-2 text-sm font-medium text-deep-violet-blue">
        {approved.name} · {retailerLabel(approved.customer_name || approved.vendor)}
      </h2>

      <ul className="mt-2 space-y-1 text-sm text-deep-violet-blue">
        <li>
          Version {approved.version} is now used for every file with this layout. Upload them as usual; they are read
          without another review.
        </li>
        <li>
          {approved.uploads_processed > 0
            ? `${approved.uploads_processed} upload${approved.uploads_processed === 1 ? '' : 's'} with this layout ${
                approved.uploads_processed === 1 ? 'was' : 'were'
              } processed into sales.`
            : 'No uploads were waiting on this mapping.'}
        </li>
      </ul>

      {failed.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          <p className="font-medium">
            The mapping was saved, but {failed.length} upload{failed.length === 1 ? '' : 's'} could not be processed:
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
            {failed.map((item) => (
              <li key={item.blob_path}>
                <span className="font-mono">{fileName(item.blob_path)}</span>: {item.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!approved.warnings?.length && (
        <ul className="mt-3 list-disc space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 pl-6 text-xs text-amber-900">
          {approved.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}

      <Disclosure variant="link" summary="Technical details" className="mt-3 text-xs text-deep-violet-blue/70">
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <BackLink href="/upload">Back to Upload</BackLink>
        <Link
          href="/mappings"
          className="rounded-md px-3 py-1.5 text-xs font-medium text-deep-violet-blue underline-offset-2 hover:underline"
        >
          All mappings
        </Link>
      </div>
    </section>
  );
}
