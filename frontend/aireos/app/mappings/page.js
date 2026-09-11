'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import { MappingReview } from '@/components/mappings/MappingReview';
import { MappingSection } from '@/components/mappings/MappingSection';
import { useMappingActions } from '../hooks/useMappingActions';

// Rendered top to bottom: proposals needing action surface first, builtin
// reference logic last since it is never actionable.
const SECTIONS = [
  {
    state: 'pending',
    label: 'Needs review',
    description: 'Claude proposed these mappings for file layouts it has not seen before.',
    badgeClass: 'border-amber-300 bg-amber-50 text-amber-900',
    // Nothing to scan past — a proposal is only useful once you can see and
    // edit its rules, so there is no collapsed state for this section.
    collapsible: false,
  },
  {
    state: 'confirmed',
    label: 'Confirmed mappings',
    description: 'Rules confirmed for a specific file layout.',
    badgeClass: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    collapsible: true,
  },
  {
    state: 'builtin',
    label: 'Built-in templates',
    description: 'Ships with the app as code — shown for reference and cannot be edited here.',
    badgeClass: 'border-zinc-300 bg-zinc-100 text-zinc-700',
    collapsible: true,
  },
];

// Listing mappings is several GCS round trips per stored contract, so this is
// well above a normal load — it is a floor for "the backend is not answering",
// not a latency budget.
const MAPPING_LOAD_TIMEOUT_MS = 20000;

export default function MappingsPage() {
  const [mappingReviews, setMappingReviews] = useState([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);
  const [mappingLoadError, setMappingLoadError] = useState('');
  const [expandedMappingIds, setExpandedMappingIds] = useState([]);

  const backendApiUrl = process.env.NEXT_PUBLIC_API_URL;

  const loadMappings = async () => {
    setIsLoadingMappings(true);
    setMappingLoadError('');

    try {
      // A backend that accepts the connection but never answers — a dead uvicorn
      // worker still holding its listen socket, say — would otherwise leave this
      // spinning with nothing on screen to explain it.
      const response = await fetch(`${backendApiUrl}/api/uploads/mappings`, {
        signal: AbortSignal.timeout(MAPPING_LOAD_TIMEOUT_MS),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          typeof data?.detail === 'string'
            ? data.detail
            : data?.detail?.message || 'Unable to load stored mappings.',
        );
      }

      setMappingReviews(Array.isArray(data?.mappings) ? data.mappings : []);
    } catch (error) {
      setMappingLoadError(
        error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? `No response from the backend at ${backendApiUrl} after ${MAPPING_LOAD_TIMEOUT_MS / 1000}s. Check that it is running.`
          : error instanceof Error
            ? error.message
            : 'Unable to load stored mappings.',
      );
    } finally {
      setIsLoadingMappings(false);
    }
  };

  useEffect(() => {
    loadMappings();
  }, [backendApiUrl]);

  const toggleMappingExpanded = (mappingId) => {
    setExpandedMappingIds((prev) =>
      prev.includes(mappingId) ? prev.filter((id) => id !== mappingId) : [...prev, mappingId],
    );
  };

  // The confirm/discard promote or remove a mapping and rewrite the packet,
  // so re-read the full list rather than patching local state to match.
  const {
    editingMappingIds,
    mappingSaveMessage,
    startEditingMapping,
    cancelEditingMapping,
    confirmMapping,
    discardMapping,
    handleMappingSourceChange,
  } = useMappingActions(backendApiUrl, mappingReviews, setMappingReviews, loadMappings);

  return (
    <AppShell>
      <div className="min-h-screen bg-cream p-8 font-sans">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <h1 className="mb-1 font-serif text-4xl text-deep-violet-blue">Mappings</h1>
              <p className="font-sans text-deep-violet-blue/80">
                Review the rules each file layout is mapped through, and confirm proposals.
              </p>
            </div>
            <button
              type="button"
              onClick={loadMappings}
              disabled={isLoadingMappings}
              className="shrink-0 rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingMappings ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {mappingLoadError && (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {mappingLoadError}
            </p>
          )}

          {mappingSaveMessage && (
            <p className="mb-4 rounded-md border border-violet bg-lavander p-3 text-sm text-deep-violet-blue">
              {mappingSaveMessage}
            </p>
          )}

          {!mappingLoadError && !mappingReviews.length && !isLoadingMappings && (
            <p className="rounded-lg border border-lavander bg-white p-5 text-sm text-deep-violet-blue/80 shadow-sm">
              No stored mappings found yet.
            </p>
          )}

          <div className="space-y-6">
            {SECTIONS.map((section) => {
              const sectionMappings = mappingReviews.filter((mapping) => mapping.state === section.state);
              if (!sectionMappings.length) return null;

              return (
                <MappingSection key={section.state} section={section} count={sectionMappings.length}>
                  {sectionMappings.map((mapping) => {
                    const isPending = mapping.state === 'pending';
                    const isExpanded = isPending || expandedMappingIds.includes(mapping.mappingId);

                    return (
                      <MappingReview
                        key={mapping.mappingId}
                        mapping={mapping}
                        isEditing={isPending || editingMappingIds.includes(mapping.mappingId)}
                        isExpanded={isExpanded}
                        onToggleExpanded={
                          section.collapsible ? () => toggleMappingExpanded(mapping.mappingId) : undefined
                        }
                        onStartEdit={mapping.editable ? startEditingMapping : undefined}
                        onCancelEdit={isPending ? undefined : cancelEditingMapping}
                        onSourceChange={handleMappingSourceChange}
                        onConfirm={confirmMapping}
                        onDiscard={discardMapping}
                        disabled={isLoadingMappings}
                      />
                    );
                  })}
                </MappingSection>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
