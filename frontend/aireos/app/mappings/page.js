'use client';

import { useCallback, useEffect, useState } from 'react';
import PageLayout from '@/components/layout/PageLayout';
import BackLink from '@/components/ui/BackLink';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import RefreshButton from '@/components/ui/RefreshButton';
import { MappingReview } from '@/components/mappings/MappingReview';
import MappingSummaryTable from '@/components/mappings/MappingSummaryTable';
import { normalizeBaseUrl } from '../utils/mappingHelpers';
import { listMappings } from '../services/mappingApi';

// Listing mappings is several GCS round trips per stored contract, so this is
// well above a normal load — it is a floor for "the backend is not answering",
// not a latency budget.
const MAPPING_LOAD_TIMEOUT_MS = 20000;

export default function MappingsPage() {
  const baseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);

  const [mappingReviews, setMappingReviews] = useState([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);
  const [mappingLoadError, setMappingLoadError] = useState('');
  const [openMappingId, setOpenMappingId] = useState(null);

  // ---- Loading ----------------------------------------------------------

  const loadMappings = useCallback(async () => {
    setIsLoadingMappings(true);
    setMappingLoadError('');

    try {
      // A backend that accepts the connection but never answers — a dead uvicorn
      // worker still holding its listen socket, say — would otherwise leave this
      // spinning with nothing on screen to explain it.
      const data = await listMappings(baseUrl, {
        signal: AbortSignal.timeout(MAPPING_LOAD_TIMEOUT_MS),
      });

      setMappingReviews(Array.isArray(data?.mappings) ? data.mappings : []);
    } catch (error) {
      setMappingLoadError(
        error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `No response from the backend at ${baseUrl} after ${MAPPING_LOAD_TIMEOUT_MS / 1000}s. Check that it is running.`
          : error.message || 'Unable to load stored mappings.',
      );
    } finally {
      setIsLoadingMappings(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    // Deferred a tick so the first render commits before the loading state
    // lands, rather than re-rendering the page on the way into it.
    Promise.resolve().then(loadMappings);
  }, [loadMappings]);

  // ---- Dialog -----------------------------------------------------------

  // The dialog is read-only: editing, approving and discarding all happen on
  // the full review page, so there is nothing to snapshot, save or guard here.
  const openMapping = (mappingId) => setOpenMappingId(mappingId);

  const closeMapping = () => setOpenMappingId(null);

  // ---- Render -----------------------------------------------------------

  const openMappingReview = mappingReviews.find(
    (mapping) => mapping.mappingId === openMappingId,
  );

  return (
    <PageLayout
      title="Stored mappings"
      headerExtra={
        <div className="ml-auto flex items-center gap-2">
          <BackLink href="/upload">Back to Upload</BackLink>
          <RefreshButton
            onClick={loadMappings}
            isRefreshing={isLoadingMappings}
            label="Refresh mappings"
          />
        </div>
      }
    >
      <p className="mb-5 -mt-1 text-sm text-deep-violet-blue/80">
        Review the rules each file layout is mapped through. Open a mapping&apos;s full review to edit, approve or discard it.
      </p>

      {mappingLoadError && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {mappingLoadError}
        </p>
      )}

      {isLoadingMappings && !mappingReviews.length && (
        <p className="text-sm text-deep-violet-blue/70">Loading mappings…</p>
      )}

      {!mappingLoadError && !mappingReviews.length && !isLoadingMappings && (
        <p className="text-sm text-deep-violet-blue/80">No stored mappings found yet.</p>
      )}

      {!!mappingReviews.length && (
        <MappingSummaryTable mappings={mappingReviews} onOpen={openMapping} />
      )}

      {/* Mounted only while a mapping is open, so the review inside never
          renders against a mapping that has just been closed or reloaded away. */}
      {openMappingReview && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeMapping();
          }}
        >
          <DialogContent className="flex max-h-[90vh] flex-col gap-3 bg-cream sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="pr-8 text-lg text-deep-violet-blue">
                {openMappingReview.name || 'Unnamed mapping'}
              </DialogTitle>
            </DialogHeader>

            <div className="-mx-4 overflow-y-auto px-4">
              <MappingReview mapping={openMappingReview} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </PageLayout>
  );
}
