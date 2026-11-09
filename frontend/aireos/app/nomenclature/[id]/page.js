'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useUploads from '@/hooks/useUploads';
import PageLayout from '@/components/layout/PageLayout';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import GuidedReview from '../../components/nomenclature/GuidedReview';
import { normalizeBaseUrl } from '../../utils/mappingHelpers';
import { lookupMapping, confirmMapping, discardMapping, previewMapping } from '../../services/mappingApi';

// A trial of the review as one question per screen (components/nomenclature),
// next to the full review at /mappings/[id], which it leaves untouched. Both
// read and save the same mapping through the same endpoints, so either can be
// used on any proposal.
export default function GuidedNomenclaturePage() {
  const { id } = useParams();
  const router = useRouter();
  const { forgetMapping } = useUploads();
  const baseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);

  const [mapping, setMapping] = useState(null);
  const [loadError, setLoadError] = useState('');
  // A proposal that was discarded is not an error to report.
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

  // As on the full review: the upload list drops the rows that were waiting
  // on this review, and the response is handed back for the finish screen.
  const handleApprove = useCallback(
    async ({ rules, instructions, name, customer_id }) => {
      const approved = await confirmMapping(baseUrl, id, { rules, instructions, name, customer_id });
      forgetMapping(id);
      return approved;
    },
    [baseUrl, id, forgetMapping],
  );

  const handleDiscard = useCallback(async () => {
    const result = await discardMapping(baseUrl, id);
    forgetMapping(id);
    router.push(`/mappings?discarded=${result?.removed_uploads?.length || 0}`);
  }, [baseUrl, id, forgetMapping, router]);

  return (
    <PageLayout title="Guided review" back={{ href: '/mappings', label: 'Nomenclatures' }}>
      {/* The step list and the screen card, in place, so nothing jumps when the mapping arrives. */}
      {isLoading && (
        <div role="status" className="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
          <span className="sr-only">Loading nomenclature…</span>
          <Skeleton className="hidden h-96 rounded-lg bg-lavander lg:block" />
          <div className="space-y-3 rounded-lg border border-lavander bg-white p-5 shadow-sm">
            <Skeleton className="h-4 w-24 rounded bg-lavander" />
            <Skeleton className="h-7 w-72 rounded bg-lavander" />
            <Skeleton className="h-48 w-full rounded-lg bg-lavander" />
          </div>
        </div>
      )}

      {isGone && (
        <div className="space-y-3 rounded-lg border border-lavander bg-white p-6 shadow-sm">
          <div className="space-y-1">
            <p className="font-serif text-lg text-deep-violet-blue">This proposal is no longer available</p>
            <p className="text-sm text-deep-violet-blue/80">It was discarded, or this link is out of date.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/upload" className={buttonVariants()}>
              Back to Upload
            </Link>
            <Link href="/mappings" className={cn(buttonVariants({ variant: 'outline' }))}>
              Nomenclatures
            </Link>
          </div>
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      )}

      {mapping && !loadError && !isGone && (
        <GuidedReview
          mapping={mapping}
          mappingId={id}
          onApprove={handleApprove}
          onDiscard={mapping.state === 'pending' ? handleDiscard : undefined}
          onPreview={handlePreview}
        />
      )}
    </PageLayout>
  );
}
