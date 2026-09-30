'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import PageLayout from '@/components/layout/PageLayout';
import MappingReviewPanel from '../../components/mappings/MappingReviewPanel';
import { normalizeBaseUrl } from '../../utils/mappingHelpers';
import {
  lookupMapping,
  confirmMapping,
  discardMapping,
  previewMapping,
} from '../../services/mappingApi';

// The review is a full page rather than a dialog: it is a table of every
// column in the file, its sample values and a rationale per row, and that does
// not fit in a modal without hiding most of what the reviewer came to read.
export default function MappingReviewPage() {
  const { id } = useParams();
  const router = useRouter();
  const baseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);

  const [mapping, setMapping] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const data = await lookupMapping(baseUrl, id);
        if (!cancelled) setMapping(data);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error.status === 404
              ? `No mapping is stored under "${id}".`
              : error.message || 'Unable to load this mapping.',
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, id]);

  const handlePreview = useCallback(
    (rules) => previewMapping(baseUrl, id, { rules }),
    [baseUrl, id],
  );

  // The panel renders the outcome — what moved where, and how many uploads
  // were re-stamped — so the response is handed back rather than swallowed by
  // a redirect.
  const handleApprove = useCallback(
    ({ rules, name, vendor }) => confirmMapping(baseUrl, id, { rules, name, vendor }),
    [baseUrl, id],
  );

  const handleDiscard = useCallback(async () => {
    await discardMapping(baseUrl, id);
    router.push('/mappings');
  }, [baseUrl, id, router]);

  return (
    <PageLayout title="Review mapping">
      {isLoading && (
        <p className="text-sm text-deep-violet-blue/70">Loading mapping…</p>
      )}

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700">{loadError}</p>
          <Link
            href="/mappings"
            className="mt-4 inline-block rounded-md border border-violet bg-white px-4 py-2 text-sm font-medium text-deep-violet-blue transition hover:bg-lavander"
          >
            All mappings
          </Link>
        </div>
      )}

      {mapping && !loadError && (
        <MappingReviewPanel
          mapping={mapping}
          onApprove={handleApprove}
          onDiscard={mapping.state === 'pending' ? handleDiscard : undefined}
          onPreview={handlePreview}
        />
      )}
    </PageLayout>
  );
}
