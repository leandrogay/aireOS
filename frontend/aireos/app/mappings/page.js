'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PageLayout from '@/components/layout/PageLayout';
import MappingList from '@/components/mappings/MappingList';
import Toast from '@/components/ui/Toast';
import useToast from '@/hooks/useToast';
import { normalizeBaseUrl } from '../utils/mappingHelpers';
import { listMappings } from '../services/mappingApi';

// Listing mappings is several GCS round trips per stored contract, so this is
// well above a normal load — it is a floor for "the backend is not answering",
// not a latency budget.
const MAPPING_LOAD_TIMEOUT_MS = 20000;

// useSearchParams (for the discard notice) wants a Suspense boundary above it.
export default function MappingsPage() {
  return (
    <Suspense fallback={null}>
      <MappingsView />
    </Suspense>
  );
}

function MappingsView() {
  const router = useRouter();
  const { toast, notify, dismissToast } = useToast();
  const baseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);

  const [mappingReviews, setMappingReviews] = useState([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);
  const [mappingLoadError, setMappingLoadError] = useState('');

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
          : error.message || 'Unable to load stored nomenclatures.',
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

  // ---- Discard notice ---------------------------------------------------

  // The review page sends ?discarded=<files removed> after a discard. Say it
  // once, then clear it so a refresh does not repeat it.
  const discarded = useSearchParams().get('discarded');

  useEffect(() => {
    if (discarded === null) return;
    const files = Number(discarded) || 0;
    notify(
      'deleted',
      files
        ? `Proposal discarded · ${files === 1 ? '1 file' : `${files} files`} removed`
        : 'Proposal discarded',
    );
    router.replace('/mappings');
  }, [discarded, notify, router]);

  // ---- Opening -----------------------------------------------------------

  // A row opens the full review: everything about a mapping -- seeing it,
  // changing it, approving it -- happens there, so a summary in between was
  // one more click before anything could be done.
  const openMapping = (mappingId) => router.push(`/mappings/${encodeURIComponent(mappingId)}`);

  // ---- Render -----------------------------------------------------------

  return (
    <PageLayout
      title="Nomenclatures"
      fitScreen
      back={{ href: '/upload', label: 'Upload' }}
    >
      <MappingList
        mappings={mappingReviews}
        isLoading={isLoadingMappings}
        error={mappingLoadError}
        onOpen={openMapping}
        onRefresh={loadMappings}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </PageLayout>
  );
}
