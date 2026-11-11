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
import { deleteMapping, discardMapping, listMappings, mappingDeleteStatus } from '../services/mappingApi';

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
  const [deleteCheck, setDeleteCheck] = useState(null);

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

  const requestDeletion = async (mapping) => {
    deletion.request(mapping);
    if (mapping.state === 'pending') {
      setDeleteCheck({ mappingId: mapping.mappingId, allowed: true, uploadCount: 0 });
      return;
    }
    setDeleteCheck({ mappingId: mapping.mappingId, loading: true });
    try {
      const status = await mappingDeleteStatus(baseUrl, mapping.mappingId);
      setDeleteCheck((current) => current?.mappingId === mapping.mappingId
        ? { mappingId: mapping.mappingId, allowed: status.allowed, uploadCount: status.upload_count }
        : current);
    } catch (error) {
      setDeleteCheck((current) => current?.mappingId === mapping.mappingId
        ? { mappingId: mapping.mappingId, error: error.message || 'Unable to check uploaded files.' }
        : current);
    }
  };

  const checked = deleteCheck?.mappingId === deletion.target?.mappingId ? deleteCheck : null;
  const deleteBlocked = deletion.target?.state === 'confirmed' && !checked?.allowed;
  const deleteDescription = deletion.target?.state === 'pending'
    ? 'This also deletes files still waiting for this proposal. This cannot be undone.'
    : checked?.loading
      ? 'Checking whether uploaded files still use this nomenclature…'
      : checked?.error
        ? checked.error
        : checked?.uploadCount
          ? `${checked.uploadCount} uploaded file${checked.uploadCount === 1 ? '' : 's'} still use this nomenclature. Roll back loaded files and delete their uploads first.`
          : 'This removes the nomenclature and its saved versions. It does not delete sales data.';

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
        onDelete={requestDeletion}
      />
      <ConfirmDialog
        open={Boolean(deletion.target)}
        title="Delete nomenclature?"
        description={deleteDescription}
        details={deletion.target ? [{ label: 'Nomenclature', value: mappingTitle(deletion.target) }] : []}
        confirmLabel="Delete nomenclature"
        pendingLabel="Deleting…"
        isPending={deletion.isPending}
        confirmDisabled={deleteBlocked}
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </PageLayout>
  );
}
