'use client';

import { useState } from 'react';

const REQUIRED_TARGET_FIELDS = ['sku', 'quantity_units', 'revenue', 'period_start'];

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

// Shared edit/confirm/discard behavior for a list of mapping review packets.
// Used by both the Mappings page (the full library) and the upload page
// (just the proposal a fresh upload produced) so the two never drift apart.
//
// onMutated(mappingId) is called after a successful confirm/discard so the
// caller can decide how its own list should change -- reload everything
// (Mappings page) or just drop the one that got resolved (upload page).
export function useMappingActions(backendApiUrl, mappingReviews, setMappingReviews, onMutated) {
  const [editingMappingIds, setEditingMappingIds] = useState([]);
  const [editSnapshots, setEditSnapshots] = useState({});
  const [mappingSaveMessage, setMappingSaveMessage] = useState('');

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
      await onMutated?.(mappingId);
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
      await onMutated?.(mappingId);
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

  return {
    editingMappingIds,
    mappingSaveMessage,
    setMappingSaveMessage,
    startEditingMapping,
    cancelEditingMapping,
    confirmMapping,
    discardMapping,
    handleMappingSourceChange,
  };
}
