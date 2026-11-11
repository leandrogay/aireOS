'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ModelUnavailableNotice from '@/components/layout/ModelUnavailableNotice';
import PageLayout from '@/components/layout/PageLayout';
import MappingList from '@/components/mappings/MappingList';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Toast from '@/components/ui/Toast';
import useConfirmAction from '@/hooks/useConfirmAction';
import useToast from '@/hooks/useToast';
import { mappingTitle } from '@/app/utils/mappingList';
import { normalizeBaseUrl } from '../utils/mappingHelpers';
import { deleteMapping, discardMapping, listMappings } from '../services/mappingApi';

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

  const deletion = useConfirmAction({ onConfirm: async (mapping) => {
    try {
      if (mapping.state === 'pending') {
        await discardMapping(baseUrl, mapping.mappingId);
      } else {
        await deleteMapping(baseUrl, mapping.mappingId);
      }
      notify('deleted', `${mappingTitle(mapping)} deleted`);
      await loadMappings();
    } catch (error) {
      notify('error', error.message || 'Unable to delete nomenclature.');
    }
  } });

  // ---- Render -----------------------------------------------------------

  return (
    <PageLayout
      title="Nomenclatures"
      fitScreen
      // Shown only once a mapping call found its model retired (backend ai_models).
      headerExtra={<ModelUnavailableNotice feature="mapping" />}
    >
      <MappingList
        mappings={mappingReviews}
        isLoading={isLoadingMappings}
        error={mappingLoadError}
        onOpen={openMapping}
        onRefresh={loadMappings}
        onDelete={deletion.request}
      />
      <ConfirmDialog
        open={Boolean(deletion.target)}
        title="Delete nomenclature?"
        description={deletion.target?.state === 'pending'
          ? 'This also deletes files still waiting for this proposal. This cannot be undone.'
          : 'Its uploaded files must be removed first. Loaded sales are never deleted by this action.'}
        details={deletion.target ? [{ label: 'Nomenclature', value: mappingTitle(deletion.target) }] : []}
        confirmLabel="Delete nomenclature"
        pendingLabel="Deleting…"
        isPending={deletion.isPending}
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </PageLayout>
  );
}
