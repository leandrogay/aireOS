'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../components/layout/AppShell';
import { MappingReview } from '../components/mappings/MappingReview';

const REQUIRED_TARGET_FIELDS = ['sku', 'quantity_units', 'revenue', 'period_start'];

// Listing mappings is several GCS round trips per stored contract, so this is
// well above a normal load — it is a floor for "the backend is not answering",
// not a latency budget.
const MAPPING_LOAD_TIMEOUT_MS = 20000;

// A rule set is indexed by target field: a required field is missing when its
// rule has no source, and a column is unread when no rule points at it.
const computeRuleMeta = (mapping, rules) => {
  const read = new Set(rules.flatMap((rule) => rule.sourceColumns || []).filter(Boolean));

  return {
    unmapped: (mapping.columns || []).filter((column) => !read.has(column)),
    requiredMissing: REQUIRED_TARGET_FIELDS.filter(
      (field) => !rules.some((rule) => rule.targetField === field && rule.sourceColumn),
    ),
  };
};

export default function MappingsPage() {
  const [mappingReviews, setMappingReviews] = useState([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);
  const [mappingLoadError, setMappingLoadError] = useState('');
  const [mappingSaveMessage, setMappingSaveMessage] = useState('');
  const [editingMappingIds, setEditingMappingIds] = useState([]);
  const [editSnapshots, setEditSnapshots] = useState({});

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
      setEditingMappingIds([]);
      setEditSnapshots({});
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
    setMappingSaveMessage('');
    stopEditingMapping(mappingId);
  };

  const confirmMapping = async (mappingId) => {
    const target = mappingReviews.find((mapping) => mapping.mappingId === mappingId);
    if (!target?.fingerprint) return;

    setMappingSaveMessage('');

    try {
      const response = await fetch(
        `${backendApiUrl}/api/uploads/mappings/${target.fingerprint}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Rules go up, not a contract: the server owns the contract shape and
          // re-validates it before anything is stored.
          body: JSON.stringify({ rules: target.rules }),
        },
      );

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof data?.detail === 'string' ? data.detail : data?.detail?.message || 'Unable to confirm mapping.',
        );
      }

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
      setMappingSaveMessage(error instanceof Error ? error.message : 'Unable to confirm mapping.');
    }
  };

  const discardMapping = async (mappingId) => {
    const target = mappingReviews.find((mapping) => mapping.mappingId === mappingId);
    if (!target?.fingerprint) return;

    setMappingSaveMessage('');

    try {
      const response = await fetch(
        `${backendApiUrl}/api/uploads/mappings/${target.fingerprint}/pending`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || 'Unable to discard proposal.');
      }

      stopEditingMapping(mappingId);
      setMappingSaveMessage('Proposal discarded.');
      await loadMappings();
    } catch (error) {
      setMappingSaveMessage(error instanceof Error ? error.message : 'Unable to discard proposal.');
    }
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

  return (
    <AppShell>
    <div className="min-h-screen bg-cream p-8 font-sans">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="mb-2 font-serif text-4xl text-deep-violet-blue">Stored Mappings</h1>
            <p className="font-sans text-deep-violet-blue/80">
              Review the rules each file layout is mapped through, and confirm proposals.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              href="/upload"
              className="rounded-md border border-deep-violet-blue bg-white px-4 py-2 text-sm font-medium text-deep-violet-blue transition hover:bg-lavander"
            >
              Back to Upload
            </Link>
            <button
              type="button"
              onClick={loadMappings}
              disabled={isLoadingMappings}
              className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingMappings ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {mappingLoadError && (
          <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {mappingLoadError}
          </p>
        )}

        {mappingSaveMessage && (
          <p className="mb-3 rounded-md border border-violet bg-lavander p-3 text-sm text-deep-violet-blue">
            {mappingSaveMessage}
          </p>
        )}

        {!mappingLoadError && !mappingReviews.length && !isLoadingMappings && (
          <p className="text-sm text-deep-violet-blue/80">No stored mappings found yet.</p>
        )}

        <div className="space-y-6">
          {mappingReviews.map((mapping) => (
            <MappingReview
              key={mapping.mappingId}
              mapping={mapping}
              isEditing={
                mapping.state === 'pending' || editingMappingIds.includes(mapping.mappingId)
              }
              onStartEdit={mapping.editable ? startEditingMapping : undefined}
              onCancelEdit={mapping.state === 'pending' ? undefined : cancelEditingMapping}
              onSourceChange={handleMappingSourceChange}
              onConfirm={confirmMapping}
              onDiscard={discardMapping}
              disabled={isLoadingMappings}
            />
          ))}
        </div>
      </div>
    </div>
    </AppShell>
  );
}
