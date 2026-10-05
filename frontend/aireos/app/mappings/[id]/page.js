'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/layout/PageLayout';
import BackLink from '@/components/ui/BackLink';
import MappingReviewPanel from '../../components/mappings/MappingReviewPanel';
import MappingReviewSkeleton from '../../components/mappings/MappingReviewSkeleton';
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
  // Once approved, the panel's own "Back to Upload" is the only way on, so
  // the header's "Back to Mappings" steps aside.
  const [isApproved, setIsApproved] = useState(false);

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
    async ({ rules, name, vendor }) => {
      const result = await confirmMapping(baseUrl, id, { rules, name, vendor });
      setIsApproved(true);
      return result;
    },
    [baseUrl, id],
  );

  const handleDiscard = useCallback(async () => {
    await discardMapping(baseUrl, id);
    router.push('/mappings');
  }, [baseUrl, id, router]);

  return (
    <PageLayout
      title="Review mapping"
      headerExtra={
        !isApproved && (
          <div className="ml-auto flex items-center gap-2">
            <BackLink href="/mappings">Back to Mappings</BackLink>
          </div>
        )
      }
    >
      {isLoading && <MappingReviewSkeleton />}

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700">{loadError}</p>
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
