'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import PageLayout from '@/components/layout/PageLayout';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import RefreshButton from '@/components/ui/RefreshButton';
import { MappingReview } from '@/components/mappings/MappingReview';
import MappingSummaryTable from '@/components/mappings/MappingSummaryTable';
import { normalizeBaseUrl } from '../utils/mappingHelpers';
import { computeRuleMeta } from '../utils/mappingReview';
import { listMappings, confirmMapping, discardMapping } from '../services/mappingApi';

// Listing mappings is several GCS round trips per stored contract, so this is
// well above a normal load — it is a floor for "the backend is not answering",
// not a latency budget.
const MAPPING_LOAD_TIMEOUT_MS = 20000;

export default function MappingsPage() {
  const baseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);

  const [mappingReviews, setMappingReviews] = useState([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);
  const [mappingLoadError, setMappingLoadError] = useState('');
  const [mappingSaveMessage, setMappingSaveMessage] = useState('');
  const [editingMappingIds, setEditingMappingIds] = useState([]);
  const [editSnapshots, setEditSnapshots] = useState({});
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
      setEditingMappingIds([]);
      setEditSnapshots({});
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

  // ---- Editing ----------------------------------------------------------

  const startEditingMapping = (mappingId) => {
    const target = mappingReviews.find((mapping) => mapping.mappingId === mappingId);
    if (!target) return;

    setMappingSaveMessage('');
    setEditSnapshots((prev) => ({ ...prev, [mappingId]: target }));
    setEditingMappingIds((prev) => (prev.includes(mappingId) ? prev : [...prev, mappingId]));
  };

  const stopEditingMapping = (mappingId) => {
    setEditingMappingIds((prev) => prev.filter((id) => id !== mappingId));
    setEditSnapshots((prev) => {
      const { [mappingId]: _discarded, ...rest } = prev;
      return rest;
    });
  };

  const cancelEditingMapping = (mappingId) => {
    const snapshot = editSnapshots[mappingId];
    if (snapshot) {
      setMappingReviews((prev) =>
        prev.map((mapping) => (mapping.mappingId === mappingId ? snapshot : mapping)),
      );
    }
    stopEditingMapping(mappingId);
  };

  const handleMappingSourceChange = (mappingId, rowIndex, nextSourceColumn) => {
    setMappingReviews((prev) =>
      prev.map((mapping) => {
        if (mapping.mappingId !== mappingId) return mapping;

        const rules = (mapping.rules || []).map((rule, index) => {
          if (index !== rowIndex) return rule;
          // Repointing a rule at a different column drops the transform note,
          // which was written for the old column.
          const changed = nextSourceColumn !== rule.sourceColumn;
          return {
            ...rule,
            sourceColumn: nextSourceColumn,
            sourceColumns: nextSourceColumn ? [nextSourceColumn] : [],
            transform: changed ? null : rule.transform,
          };
        });

        return {
          ...mapping,
          rules,
          ...computeRuleMeta(mapping, rules),
        };
      }),
    );
  };

  // ---- Dialog -----------------------------------------------------------

  const openMapping = (mappingId) => {
    setMappingSaveMessage('');
    setOpenMappingId(mappingId);

    // A proposal opens straight into editing, so snapshot it now: closing the
    // dialog without confirming should leave it as the server has it.
    const target = mappingReviews.find((mapping) => mapping.mappingId === mappingId);
    if (target?.state === 'pending') startEditingMapping(mappingId);
  };

  // Closing is walking away from any unsaved edits, so it restores the
  // snapshot the same way Cancel does.
  const closeMapping = () => {
    if (openMappingId) cancelEditingMapping(openMappingId);
    setOpenMappingId(null);
  };

  // ---- Confirm / discard ------------------------------------------------

  const handleConfirm = async (mappingId) => {
    const target = mappingReviews.find((mapping) => mapping.mappingId === mappingId);
    if (!target?.fingerprint) return;

    setMappingSaveMessage('');

    try {
      // Rules go up, not a contract: the server owns the contract shape and
      // re-validates it before anything is stored. Name and vendor are
      // inherited from the stored mapping — an amendment does not rename
      // what it amends, and a first approval happens on the review page,
      // which asks for them.
      const data = await confirmMapping(baseUrl, target.fingerprint, { rules: target.rules });

      stopEditingMapping(mappingId);
      setMappingSaveMessage(
        data?.warnings?.length
          ? `Confirmed with ${data.warnings.length} warning(s).`
          : 'Mapping confirmed.',
      );
      // The confirm promotes pending -> confirmed and rewrites the packet, so
      // re-read rather than patching local state to match.
      await loadMappings();
    } catch (error) {
      setMappingSaveMessage(error.message || 'Unable to confirm mapping.');
    }
  };

  const handleDiscard = async (mappingId) => {
    const target = mappingReviews.find((mapping) => mapping.mappingId === mappingId);
    if (!target?.fingerprint) return;

    setMappingSaveMessage('');

    try {
      await discardMapping(baseUrl, target.fingerprint);

      stopEditingMapping(mappingId);
      setOpenMappingId(null);
      setMappingSaveMessage('Proposal discarded.');
      await loadMappings();
    } catch (error) {
      setMappingSaveMessage(error.message || 'Unable to discard proposal.');
    }
  };

  // ---- Render -----------------------------------------------------------

  const openMappingReview = mappingReviews.find(
    (mapping) => mapping.mappingId === openMappingId,
  );

  return (
    <PageLayout
      title="Stored mappings"
      headerExtra={
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/upload"
            className="rounded-md border border-violet bg-white px-3 py-1.5 text-xs font-medium text-deep-violet-blue transition hover:bg-lavander"
          >
            Back to Upload
          </Link>
          <RefreshButton
            onClick={loadMappings}
            isRefreshing={isLoadingMappings}
            label="Refresh mappings"
          />
        </div>
      }
    >
      <p className="mb-5 -mt-1 text-sm text-deep-violet-blue/80">
        Review the rules each file layout is mapped through, and confirm proposals.
      </p>

      {mappingLoadError && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {mappingLoadError}
        </p>
      )}

      {mappingSaveMessage && !openMappingReview && (
        <p className="mb-3 rounded-md border border-violet bg-lavander p-3 text-sm text-deep-violet-blue">
          {mappingSaveMessage}
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
          renders against a mapping that has just been closed or discarded. */}
      {openMappingReview && (
        <Dialog
          open
          onOpenChange={(open) => {
            // A save in flight cannot be walked away from half-done.
            if (!open && !isLoadingMappings) closeMapping();
          }}
        >
          <DialogContent className="flex max-h-[90vh] flex-col gap-3 bg-cream sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="pr-8 text-lg text-deep-violet-blue">
                {openMappingReview.name || 'Unnamed mapping'}
              </DialogTitle>
            </DialogHeader>

            <div className="-mx-4 overflow-y-auto px-4">
              {mappingSaveMessage && (
                <p className="mb-3 rounded-md border border-violet bg-lavander p-3 text-sm text-deep-violet-blue">
                  {mappingSaveMessage}
                </p>
              )}
              <MappingReview
                mapping={openMappingReview}
                isEditing={
                  openMappingReview.state === 'pending' ||
                  editingMappingIds.includes(openMappingReview.mappingId)
                }
                onStartEdit={openMappingReview.editable ? startEditingMapping : undefined}
                onCancelEdit={
                  openMappingReview.state === 'pending' ? undefined : cancelEditingMapping
                }
                onSourceChange={handleMappingSourceChange}
                onConfirm={handleConfirm}
                onDiscard={handleDiscard}
                disabled={isLoadingMappings}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </PageLayout>
  );
}
