'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, EyeOff } from 'lucide-react';
import StatusBadge from '../ui/StatusBadge';
import ColumnMappingRow from './ColumnMappingRow';
import FieldCoverage from './FieldCoverage';
import {
  toColumnRows,
  toRules,
  reviewIssues,
  computeCoverage,
} from '../../utils/mappingReview';

const button =
  'rounded-md border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const primary = `${button} border-deep-violet-blue bg-deep-violet-blue text-white hover:opacity-90`;
const secondary = `${button} border-violet bg-white text-deep-violet-blue hover:bg-lavander`;

const STATE_BADGE = {
  builtin: { tone: 'neutral', label: 'Built-in mapping' },
  confirmed: { tone: 'ready', label: 'Confirmed mapping' },
  pending: { tone: 'review', label: 'Awaiting approval' },
};

function OutputPreview({ preview, isLoading, error, onRefresh, disabled }) {
  const rows = preview?.preview || [];
  const columns = (preview?.columns || []).slice(0, 8);

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-serif text-lg text-deep-violet-blue">Output preview</h3>
        <button type="button" onClick={onRefresh} disabled={isLoading || disabled} className={secondary}>
          {isLoading ? 'Running…' : 'Preview these rules'}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {!error && !rows.length && !isLoading && (
        <p className="text-sm text-deep-violet-blue/70">
          Run a preview to see these rules applied to the file this mapping came from.
        </p>
      )}

      {!error && !!rows.length && (
        <>
          <div className="overflow-x-auto rounded-lg border border-lavander">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-lavander text-deep-violet-blue">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="px-3 py-2 font-medium whitespace-nowrap">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-deep-violet-blue">
                {rows.map((row, index) => (
                  <tr key={index} className="border-t border-lavander">
                    {columns.map((column) => (
                      <td key={column} className="px-3 py-2 whitespace-nowrap">
                        {row[column] == null || row[column] === '' ? '—' : String(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-xs text-deep-violet-blue/60">
            {rows.length} of {preview.rows_total?.toLocaleString()} output rows
            {preview.columns?.length > columns.length &&
              ` · ${preview.columns.length - columns.length} more target fields`}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * The human-in-the-loop review: every source column, what the proposal thinks
 * it is, and how sure it was.
 *
 * @param {{
 *   mapping: object,
 *   onApprove: (payload: { rules: object[], name: string, vendor: string }) => Promise<void>,
 *   onDiscard?: () => Promise<void>,
 *   onPreview: (rules: object[]) => Promise<object>,
 * }} props
 */
export default function MappingReviewPanel({ mapping, onApprove, onDiscard, onPreview }) {
  const [rows, setRows] = useState(() => toColumnRows(mapping));
  const [confirmedColumns, setConfirmedColumns] = useState(() => new Set());
  const [name, setName] = useState(mapping.name || '');
  const [vendor, setVendor] = useState(mapping.vendor || '');
  const [busy, setBusy] = useState(null); // null | 'approve' | 'discard' | 'preview'
  const [message, setMessage] = useState('');
  const [approved, setApproved] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');

  const readOnly = mapping.editable === false;
  const issues = useMemo(
    () => reviewIssues(mapping, rows, confirmedColumns, mapping.requiredFields),
    [mapping, rows, confirmedColumns],
  );
  const coverage = useMemo(() => computeCoverage(mapping, rows), [mapping, rows]);

  // Which column already fills each field, so a row does not offer a field
  // another column has taken. A column filling several fields is fine; a field
  // filled by several columns is not.
  const takenFields = useMemo(() => {
    const taken = new Map();
    rows.forEach((row) => {
      row.fields.forEach((field) => {
        if (!taken.has(field.targetField)) taken.set(field.targetField, row.column);
      });
    });
    return taken;
  }, [rows]);

  // A column can fill several fields, so adding one appends rather than
  // replacing what is there. A field moved off another column is taken off it,
  // since two columns cannot fill the same field.
  const handleAddField = useCallback((column, targetField) => {
    setMessage('');
    setRows((prev) =>
      prev.map((row) => {
        if (row.locked) return row;

        if (row.column === column) {
          if (row.fields.some((field) => field.targetField === targetField)) return row;
          return {
            ...row,
            fields: [
              ...row.fields,
              // The reviewer chose it, so it is not a guess -- but the
              // rationale says whose decision it was.
              { targetField, confidence: 'high', rationale: 'Chosen by the reviewer.' },
            ],
          };
        }

        const without = row.fields.filter((field) => field.targetField !== targetField);
        return without.length === row.fields.length ? row : { ...row, fields: without };
      }),
    );
    // Editing a row is the reviewer taking responsibility for it, which is
    // exactly what confirming it means.
    setConfirmedColumns((prev) => new Set(prev).add(column));
  }, []);

  const handleRemoveField = useCallback((column, targetField) => {
    setMessage('');
    setRows((prev) =>
      prev.map((row) =>
        row.column === column && !row.locked
          ? { ...row, fields: row.fields.filter((f) => f.targetField !== targetField) }
          : row,
      ),
    );
    setConfirmedColumns((prev) => new Set(prev).add(column));
  }, []);

  const handleConfirmRow = useCallback((column) => {
    setConfirmedColumns((prev) => new Set(prev).add(column));
  }, []);

  // The coverage panel reaches the same edit from the other end: pick the
  // field first, then the column that holds it.
  const handleAssignField = useCallback(
    (field, column) => handleAddField(column, field),
    [handleAddField],
  );

  const handleClearField = useCallback((field) => {
    setMessage('');
    setRows((prev) =>
      prev.map((row) =>
        row.locked
          ? row
          : { ...row, fields: row.fields.filter((f) => f.targetField !== field) },
      ),
    );
  }, []);

  const handleMeltGroupChange = useCallback((column, changes) => {
    setRows((prev) => {
      const edited = prev.find((row) => row.column === column);
      if (!edited?.meltGroup) return prev;

      // Every column in the group shares one melt group, so the edit lands on
      // all of them — otherwise the rebuilt rule would depend on which row
      // happened to be typed in.
      return prev.map((row) =>
        row.meltGroup && row.ruleIndex === edited.ruleIndex
          ? { ...row, meltGroup: { ...row.meltGroup, ...changes } }
          : row,
      );
    });
  }, []);

  const acceptAllHighConfidence = useCallback(() => {
    setConfirmedColumns((prev) => {
      const next = new Set(prev);
      rows.forEach((row) => {
        if (row.confidence === 'high') next.add(row.column);
      });
      return next;
    });
    setMessage('High-confidence rows accepted. Low-confidence rows still need confirming.');
  }, [rows]);

  const runPreview = useCallback(async () => {
    setBusy('preview');
    setPreviewError('');
    try {
      setPreview(await onPreview(toRules(mapping, rows)));
    } catch (error) {
      setPreview(null);
      setPreviewError(error.message);
    } finally {
      setBusy(null);
    }
  }, [mapping, onPreview, rows]);

  const blockers = [
    issues.unconfirmedLowConfidence.length &&
      `${issues.unconfirmedLowConfidence.length} low-confidence column${
        issues.unconfirmedLowConfidence.length === 1 ? '' : 's'
      } still to confirm`,
    issues.duplicateTargets.length &&
      `Two columns both map to ${issues.duplicateTargets.join(', ')}`,
    !name.trim() && 'A mapping name is needed',
    !vendor.trim() && 'A vendor is needed',
  ].filter(Boolean);

  const handleApprove = useCallback(async () => {
    setBusy('approve');
    setMessage('');
    try {
      setApproved(
        await onApprove({
          rules: toRules(mapping, rows),
          name: name.trim(),
          vendor: vendor.trim(),
        }),
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }, [mapping, name, onApprove, rows, vendor]);

  const handleDiscard = useCallback(async () => {
    setBusy('discard');
    setMessage('');
    try {
      await onDiscard();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }, [onDiscard]);

  const badge = STATE_BADGE[mapping.state] || STATE_BADGE.pending;

  // Approving moves the contract from mappings/pending/ to mappings/confirmed/
  // and re-stamps the uploads that were waiting on it. Both of those happen out
  // of sight, so the screen says so rather than just navigating away.
  if (approved) {
    return (
      <section className="rounded-xl border border-green-300 bg-green-50 p-6 shadow-sm">
        <StatusBadge tone="ready">Mapping confirmed</StatusBadge>
        <h2 className="mt-2 font-serif text-xl text-deep-violet-blue">
          {approved.name} · {approved.vendor}
        </h2>

        <ul className="mt-3 space-y-1 text-sm text-deep-violet-blue">
          <li>
            Moved to <span className="font-mono text-xs">{approved.moved_to}</span>
            {approved.pending_removed === false && (
              <span className="text-amber-900">
                {' '}
                — the pending copy could not be removed; it is ignored on lookup, but
                worth clearing up.
              </span>
            )}
          </li>
          <li>
            {approved.uploads_updated > 0
              ? `${approved.uploads_updated} recent upload${
                  approved.uploads_updated === 1 ? '' : 's'
                } now shown as mapped.`
              : 'No earlier uploads were waiting on this mapping.'}
          </li>
        </ul>

        {!!approved.warnings?.length && (
          <ul className="mt-3 list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 pl-7 text-sm text-amber-900">
            {approved.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/upload" className={primary}>
            Back to uploads
          </Link>
          <Link href="/mappings" className={secondary}>
            All mappings
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-lavander bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
            <h2 className="mt-2 font-serif text-xl text-deep-violet-blue">
              {mapping.name || 'Unnamed mapping'}
            </h2>
            <p className="text-sm text-deep-violet-blue/70">
              {mapping.vendor ? `${mapping.vendor} · ` : ''}
              <span className="font-mono text-xs">{mapping.mappingId}</span>
            </p>
            {mapping.filename && (
              <p className="mt-1 text-xs break-all text-deep-violet-blue/60">
                From {mapping.filename}
              </p>
            )}
          </div>
          <Link href="/mappings" className={secondary}>
            All mappings
          </Link>
        </div>

        {readOnly && (
          <p className="rounded-lg border border-violet bg-lavander/50 p-3 text-sm text-deep-violet-blue">
            These rules run as code in the backend, so they are shown for reference and
            cannot be edited here.
          </p>
        )}

        {!!issues.missingRequired.length && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              No column fills the required field
              {issues.missingRequired.length === 1 ? '' : 's'}{' '}
              <span className="font-mono text-xs">{issues.missingRequired.join(', ')}</span>.
              The ingest step needs {issues.missingRequired.length === 1 ? 'it' : 'them'}.
            </span>
          </p>
        )}

        {!!issues.ignoredColumns.length && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-lavander bg-cream p-3 text-sm text-deep-violet-blue">
            <EyeOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              {issues.ignoredColumns.length} column
              {issues.ignoredColumns.length === 1 ? '' : 's'} will be ignored:{' '}
              <span className="font-mono text-xs">{issues.ignoredColumns.join(', ')}</span>
            </span>
          </p>
        )}

        {!!mapping.warnings?.length && (
          <ul className="mt-3 list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 pl-7 text-sm text-amber-900">
            {mapping.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        )}
      </section>

      <FieldCoverage
        coverage={coverage}
        rows={rows}
        onAssign={handleAssignField}
        onClear={handleClearField}
        readOnly={readOnly || busy !== null}
      />

      <section className="rounded-xl border border-lavander bg-white p-6 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-serif text-lg text-deep-violet-blue">Column mapping</h3>
            <p className="text-xs text-deep-violet-blue/70">
              Least certain first — those are the ones worth your time.
            </p>
          </div>
          {!readOnly && (
            <button type="button" onClick={acceptAllHighConfidence} className={secondary}>
              Accept all high-confidence
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border border-lavander">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-lavander text-deep-violet-blue">
              <tr>
                <th className="px-3 py-2 font-medium">Source column</th>
                <th className="px-3 py-2 font-medium">Sample values</th>
                <th className="px-3 py-2 font-medium">Becomes</th>
                <th className="px-3 py-2 font-medium">Confidence</th>
                <th className="px-3 py-2 font-medium">Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ColumnMappingRow
                  key={row.column}
                  row={row}
                  targetFields={mapping.targetFields || []}
                  takenFields={takenFields}
                  confirmed={confirmedColumns.has(row.column)}
                  onAddField={handleAddField}
                  onRemoveField={handleRemoveField}
                  onConfirm={handleConfirmRow}
                  onMeltGroupChange={handleMeltGroupChange}
                  readOnly={readOnly}
                  disabled={readOnly || busy !== null}
                />
              ))}
            </tbody>
          </table>
        </div>

        <OutputPreview
          preview={preview}
          isLoading={busy === 'preview'}
          error={previewError}
          onRefresh={runPreview}
          disabled={busy !== null && busy !== 'preview'}
        />
      </section>

      {!readOnly && (
        <section className="rounded-xl border border-lavander bg-white p-6 shadow-sm">
          <h3 className="mb-1 font-serif text-lg text-deep-violet-blue">Save for reuse</h3>
          <p className="mb-4 text-sm text-deep-violet-blue/70">
            Every future file with this column layout runs through these rules.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-deep-violet-blue">
              Mapping name
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. XEL weekly sell-out"
                className="mt-1 w-full rounded-md border border-violet bg-white px-3 py-2 text-sm text-deep-violet-blue focus:border-deep-violet-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue"
              />
            </label>
            <label className="block text-sm text-deep-violet-blue">
              Vendor
              <input
                type="text"
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
                placeholder="e.g. FairPrice"
                className="mt-1 w-full rounded-md border border-violet bg-white px-3 py-2 text-sm text-deep-violet-blue focus:border-deep-violet-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue"
              />
            </label>
          </div>

          {!!blockers.length && (
            <ul className="mt-4 list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 pl-7 text-sm text-amber-900">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}

          {message && (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {message}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {onDiscard && mapping.state === 'pending' && (
              <button
                type="button"
                onClick={handleDiscard}
                disabled={busy !== null}
                className={`${button} border-red-300 bg-white text-red-700 hover:bg-red-50`}
              >
                {busy === 'discard' ? 'Discarding…' : 'Discard proposal'}
              </button>
            )}
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy !== null || blockers.length > 0}
              className={primary}
            >
              {busy === 'approve' ? 'Saving…' : 'Approve mapping'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
