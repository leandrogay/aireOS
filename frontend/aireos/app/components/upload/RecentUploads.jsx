'use client';

import Link from 'next/link';
import RefreshButton from '@/components/ui/RefreshButton';
import StatusBadge from '../ui/StatusBadge';

// The mapping status recorded on each blob at upload time, as something a
// person reads. Anything unrecognised falls through to the raw value rather
// than being hidden.
const STATUS_LABELS = {
  mapped: { tone: 'ready', label: 'Mapped' },
  pending_confirmation: { tone: 'review', label: 'Needs review' },
  partial_match: { tone: 'review', label: 'Needs review' },
  mapping_failed: { tone: 'failed', label: 'Mapping failed' },
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * @param {{ uploads: object[], isLoading: boolean, error: string, onRefresh: () => void }} props
 */
export default function RecentUploads({ uploads, isLoading, error, onRefresh }) {
  return (
    <section className="rounded-xl border border-lavander bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-xl text-deep-violet-blue">Recent uploads</h2>
        <RefreshButton
          onClick={onRefresh}
          isRefreshing={isLoading}
          label="Refresh uploads"
          className="rounded-md border-violet bg-white text-deep-violet-blue hover:bg-lavander"
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {!error && !uploads.length && !isLoading && (
        <p className="text-sm text-deep-violet-blue/70">Nothing has been uploaded yet.</p>
      )}

      {!error && !!uploads.length && (
        <div className="overflow-x-auto rounded-lg border border-lavander">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-lavander text-deep-violet-blue">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">Uploaded</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Mapping</th>
              </tr>
            </thead>
            <tbody className="text-deep-violet-blue">
              {uploads.map((upload) => {
                const status = STATUS_LABELS[upload.mapping_status];

                return (
                  <tr key={upload.blob_path} className="border-t border-lavander">
                    <td className="max-w-[18rem] truncate px-3 py-2" title={upload.filename}>
                      {upload.filename}
                    </td>
                    <td className="px-3 py-2">{upload.vendor || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDate(upload.uploaded_at)}
                    </td>
                    <td className="px-3 py-2">
                      {status ? (
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">
                          {upload.mapping_status || 'Unknown'}
                        </StatusBadge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {upload.mapping_fingerprint ? (
                        <Link
                          href={`/mappings/${upload.mapping_fingerprint}`}
                          className="font-medium underline underline-offset-2 hover:opacity-80"
                        >
                          {/* Once a mapping is approved under a name, that name
                              is what identifies it here. */}
                          {upload.mapping_name || 'View mapping'}
                        </Link>
                      ) : (
                        <span className="text-deep-violet-blue/60">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
