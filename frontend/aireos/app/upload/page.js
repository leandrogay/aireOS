'use client';

import { useEffect, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import FileUpload from '../components/upload/FileUpload';
import { MappingReview } from '../components/upload/MappingReview';

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

export default function UploadPage() {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [duplicates, setDuplicates] = useState([]);
  const [mappingReviews, setMappingReviews] = useState([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);
  const [mappingLoadError, setMappingLoadError] = useState('');
  const [mappingSaveMessage, setMappingSaveMessage] = useState('');
  const [editingMappingIds, setEditingMappingIds] = useState([]);
  const [editSnapshots, setEditSnapshots] = useState({});
  const [isUploading, setIsUploading] = useState(false);

const backendApiUrl = process.env.NEXT_PUBLIC_API_URL;

  const postFiles = async (files, force) => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });
    formData.append('force', force ? 'true' : 'false');

    const response = await fetch(`${backendApiUrl}/api/uploads`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json().catch(() => null);
    return { response, data };
  };

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

  const handleUpload = async (files) => {
    setUploadedFiles(files);
    setUploadResult(null);
    setDuplicates([]);

    if (!files?.length) {
      setUploadResult({
        success: false,
        uploaded: 0,
        failed: 0,
        results: [],
        message: 'No files selected for upload.',
      });
      return;
    }

    setIsUploading(true);

    try {
      const { response, data } = await postFiles(files, false);

      if (!response.ok) {
        setUploadResult({
          success: false,
          uploaded: 0,
          failed: files.length,
          results: [],
          message: data?.detail || 'Upload failed. Please try again.',
        });
        return;
      }

      const results = Array.isArray(data?.results) ? data.results : [];
      const duplicateResults = results
        .map((item, index) => ({ ...item, id: index, file: files[index] }))
        .filter((item) => item.reason === 'duplicate' && item.file);
      setDuplicates(duplicateResults);

      loadMappings();

      setUploadResult({
        success: Boolean(data?.success),
        uploaded: data?.uploaded ?? 0,
        duplicates: data?.duplicates ?? 0,
        failed: data?.failed ?? 0,
        results: results.filter((item) => item.reason !== 'duplicate'),
        message: null,
      });
    } catch (error) {
      setUploadResult({
        success: false,
        uploaded: 0,
        failed: files.length,
        results: [],
        message:
          'Unable to connect to backend upload service. Check NEXT_PUBLIC_API_URL, server status, and CORS settings.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleReplace = async (duplicate) => {
    setIsUploading(true);

    try {
      const { response, data } = await postFiles([duplicate.file], true);
      const results = Array.isArray(data?.results) ? data.results : [];
      const replaced = results[0];

      setDuplicates((prev) => prev.filter((item) => item.id !== duplicate.id));

      setUploadResult((prev) => {
        const base = prev || { success: true, uploaded: 0, duplicates: 0, failed: 0, results: [], message: null };
        const stillOk = response.ok && replaced?.success;
        const nextUploaded = base.uploaded + (stillOk ? 1 : 0);
        const nextDuplicates = Math.max(0, (base.duplicates || 0) - 1);
        const nextFailed = base.failed + (stillOk ? 0 : 1);
        return {
          ...base,
          uploaded: nextUploaded,
          duplicates: nextDuplicates,
          failed: nextFailed,
          success: nextFailed === 0 && nextDuplicates === 0,
          results: [
            ...base.results,
            stillOk
              ? replaced
              : {
                  success: false,
                  filename: duplicate.filename,
                  error: data?.detail || replaced?.error || 'Replace failed. Please try again.',
                },
          ],
        };
      });
    } catch (error) {
      setDuplicates((prev) => prev.filter((item) => item.id !== duplicate.id));
      setUploadResult((prev) => {
        const base = prev || { success: true, uploaded: 0, duplicates: 0, failed: 0, results: [], message: null };
        const nextFailed = base.failed + 1;
        return {
          ...base,
          failed: nextFailed,
          success: false,
          results: [
            ...base.results,
            {
              success: false,
              filename: duplicate.filename,
              error: 'Unable to connect to backend upload service.',
            },
          ],
        };
      });
    } finally {
      setIsUploading(false);
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
        <h1 className="mb-2 font-serif text-4xl text-deep-violet-blue">Upload Sales Data</h1>
        <p className="mb-8 font-sans text-deep-violet-blue/80">
          Upload your offline retailer sales data files to get started
        </p>

        <section className="mb-8 rounded-lg border border-lavander bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl text-deep-violet-blue">Stored Mappings</h2>
              <p className="text-sm text-deep-violet-blue/80">
                Review the rules each file layout is mapped through, and confirm proposals.
              </p>
            </div>
            <button
              type="button"
              onClick={loadMappings}
              disabled={isLoadingMappings}
              className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingMappings ? 'Loading...' : 'Refresh'}
            </button>
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
                disabled={isUploading || isLoadingMappings}
              />
            ))}
          </div>
        </section>

        <FileUpload onUpload={handleUpload} disabled={isUploading} />

        {uploadedFiles.length > 0 && (
          <div className="mt-8 rounded-lg border border-green-200 bg-green-50 p-6">
            <h2 className="mb-4 font-serif text-lg text-green-900">
              ✓ Selected ({uploadedFiles.length} file{uploadedFiles.length > 1 ? 's' : ''})
            </h2>
            <ul className="space-y-2">
              {uploadedFiles.map((file) => (
                <li key={file.name} className="text-green-800">
                  {file.name} ({(file.size / 1024).toFixed(2)} KB)
                </li>
              ))}
            </ul>
          </div>
        )}

        {duplicates.length > 0 && (
          <div className="mt-6 rounded-lg border border-yellow-300 bg-yellow-50 p-6">
            <h2 className="mb-2 font-serif text-lg text-yellow-900">
              Possible duplicate{duplicates.length > 1 ? 's' : ''} detected
            </h2>
            <p className="mb-4 text-sm text-yellow-800">
              These filenames were already uploaded before. Uploading again would double-count sales unless you replace the existing file.
            </p>
            <ul className="space-y-3">
              {duplicates.map((dup) => (
                <li
                  key={dup.id}
                  className="flex flex-col gap-2 rounded-md border border-yellow-200 bg-white p-3 text-sm text-yellow-900 md:flex-row md:items-center md:justify-between"
                >
                  <span>
                    <span className="font-medium">{dup.filename}</span>
                    {dup.existing_uploaded_at && (
                      <> was previously uploaded {new Date(dup.existing_uploaded_at).toLocaleString()}</>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleReplace(dup)}
                    disabled={isUploading}
                    className="rounded-md border border-yellow-600 bg-yellow-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-yellow-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Replace existing file
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {uploadResult && (
          <div
            className={`mt-6 rounded-lg border p-6 ${
              uploadResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
            }`}
          >
            <h2 className={`mb-3 font-serif text-lg ${uploadResult.success ? 'text-green-900' : 'text-red-900'}`}>
              {uploadResult.success ? 'Upload completed' : 'Upload completed with errors'}
            </h2>

            <p className="mb-4 text-sm text-deep-violet-blue">
              Uploaded: {uploadResult.uploaded}
              {uploadResult.duplicates ? ` | Duplicates pending: ${uploadResult.duplicates}` : ''}
              {' | '}Failed: {uploadResult.failed}
            </p>

            {uploadResult.message && <p className="mb-3 text-sm text-red-700">{uploadResult.message}</p>}

            {!!uploadResult.results.length && (
              <ul className="space-y-2">
                {uploadResult.results.map((item, index) => (
                  <li
                    key={`${item.filename || 'file'}-${index}`}
                    className={`rounded-md p-3 text-sm ${item.success ? 'bg-white text-green-800' : 'bg-white text-red-800'}`}
                  >
                    {item.success
                      ? `${item.filename} uploaded to ${item.destination}`
                      : `${item.filename || 'Unknown file'} - ${item.error || 'Upload failed'}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
    </AppShell>
  );
}