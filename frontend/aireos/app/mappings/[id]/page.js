'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useUploads from '@/hooks/useUploads';
import PageLayout from '@/components/layout/PageLayout';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
  const { forgetMapping } = useUploads();
  const baseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);

  const [mapping, setMapping] = useState(null);
  const [loadError, setLoadError] = useState('');
  // A proposal that was discarded (here or in another tab) is not an error to
  // report, so the page says what happened and where to go instead.
  const [isGone, setIsGone] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setLoadError('');
      setIsGone(false);
      try {
        const data = await lookupMapping(baseUrl, id);
        if (!cancelled) setMapping(data);
      } catch (error) {
        if (!cancelled) {
          if (error.status === 404) setIsGone(true);
          else setLoadError(error.message || 'Unable to load this nomenclature.');
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
    ({ rules, instructions }) => previewMapping(baseUrl, id, { rules, instructions }),
    [baseUrl, id],
  );

  // The panel renders the outcome — what moved where, and how many uploads
  // were re-stamped — so the response is handed back rather than swallowed by
  // a redirect. The review is done, so the upload list drops the rows that were
  // waiting on it; the files carry on in Recent uploads.
  const handleApprove = useCallback(
    async ({ rules, instructions, name, customer_id }) => {
      const approved = await confirmMapping(baseUrl, id, { rules, instructions, name, customer_id });
      forgetMapping(id);
      return approved;
    },
    [baseUrl, id, forgetMapping],
  );

  // The server deleted the files that were waiting on this proposal, so the
  // upload list drops their rows now rather than offering a review that no
  // longer exists. The count rides to /mappings, which says it in a toast.
  const handleDiscard = useCallback(async () => {
    const result = await discardMapping(baseUrl, id);
    forgetMapping(id);
    router.push(`/mappings?discarded=${result?.removed_uploads?.length || 0}`);
  }, [baseUrl, id, forgetMapping, router]);

  return (
    <PageLayout
      title="Review nomenclature"
      back={{ href: '/mappings', label: 'Nomenclatures' }}
    >
      {isLoading && <MappingReviewSkeleton />}

      {isGone && (
        <div className="space-y-3 rounded-xl border border-lavander bg-white p-6">
          <div className="space-y-1">
            <p className="font-serif text-lg text-deep-violet-blue">This proposal is no longer available</p>
            <p className="text-sm text-deep-violet-blue/80">
              It was discarded, or this link is out of date.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/upload"
              className={cn(buttonVariants(), 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90')}
            >
              Back to Upload
            </Link>
            <Link
              href="/mappings"
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'border-violet/60 bg-white text-deep-violet-blue hover:bg-lavander',
              )}
            >
              Nomenclatures
            </Link>
          </div>
        </div>
      )}

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      )}

      {mapping && !loadError && !isGone && (
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
