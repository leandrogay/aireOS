'use client';

import { useState } from 'react';
import AppShell from '../components/layout/AppShell';
import FileUpload from '../components/upload/FileUpload';
import { MappingReview } from '../components/mappings/MappingReview';
import { MappingSection } from '../components/mappings/MappingSection';
import { useMappingActions } from '../hooks/useMappingActions';

// Matches the "Needs review" section on /mappings, so a proposal reads the
// same way whether it's seen right after upload or later in the library.
const PENDING_SECTION = {
  label: 'Needs review',
  description: 'Claude proposed these mappings for the file layout(s) just uploaded.',
  badgeClass: 'border-amber-300 bg-amber-50 text-amber-900',
};

export default function UploadPage() {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [duplicates, setDuplicates] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFingerprints, setPendingFingerprints] = useState([]);
  const [pendingMappingReviews, setPendingMappingReviews] = useState([]);

const backendApiUrl = process.env.NEXT_PUBLIC_API_URL;

  // The upload response only carries the raw contract, not the review-ready
  // packet shape (rules/columns/warnings) that MappingReview renders -- that
  // shape only exists server-side via the mappings list endpoint, so re-fetch
  // it and keep just the proposals this page actually produced.
  const refreshPendingMappings = async (fingerprints) => {
    if (!fingerprints.length) {
      setPendingMappingReviews([]);
      return;
    }

    try {
      const response = await fetch(`${backendApiUrl}/api/uploads/mappings`);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMappingSaveMessage(
          typeof data?.detail === 'string'
            ? data.detail
            : 'The upload succeeded, but the proposed mapping could not be loaded for review. Try Refresh on the Mappings page.',
        );
        return;
      }

      const mappings = Array.isArray(data?.mappings) ? data.mappings : [];
      const matched = mappings.filter(
        (mapping) => mapping.state === 'pending' && fingerprints.includes(mapping.fingerprint),
      );
      setPendingMappingReviews(matched);

      if (!matched.length) {
        // The upload reported a fresh proposal, but the mappings list doesn't
        // have it under that fingerprint yet -- surfaced instead of just
        // silently showing nothing, since that combination usually means the
        // list was read before the write landed, or the fingerprints
        // diverged somehow.
        setMappingSaveMessage(
          'The upload produced a new mapping proposal, but it could not be found when reloading the list. Try Refresh on the Mappings page.',
        );
      }
    } catch (error) {
      // The upload itself already succeeded -- this only means the follow-up
      // fetch to load the proposal for review failed, so say so instead of
      // leaving the page looking like nothing happened.
      setMappingSaveMessage(
        error instanceof Error
          ? `The upload succeeded, but the proposed mapping could not be loaded for review: ${error.message}`
          : 'The upload succeeded, but the proposed mapping could not be loaded for review.',
      );
    }
  };

  const {
    mappingSaveMessage,
    setMappingSaveMessage,
    confirmMapping,
    discardMapping,
    handleMappingSourceChange,
  } = useMappingActions(
    backendApiUrl,
    pendingMappingReviews,
    setPendingMappingReviews,
    (mappingId) => {
      setPendingFingerprints((prev) => prev.filter((fp) => fp !== mappingId));
      setPendingMappingReviews((prev) => prev.filter((mapping) => mapping.mappingId !== mappingId));
    },
  );

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

      setUploadResult({
        success: Boolean(data?.success),
        uploaded: data?.uploaded ?? 0,
        duplicates: data?.duplicates ?? 0,
        failed: data?.failed ?? 0,
        results: results.filter((item) => item.reason !== 'duplicate'),
        message: null,
      });

      const newFingerprints = results
        .filter((item) => item.mapping?.status === 'pending_confirmation')
        .map((item) => item.mapping.fingerprint)
        .filter(Boolean);

      if (newFingerprints.length) {
        const nextFingerprints = Array.from(new Set([...pendingFingerprints, ...newFingerprints]));
        setPendingFingerprints(nextFingerprints);
        await refreshPendingMappings(nextFingerprints);
      }
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

      if (replaced?.mapping?.status === 'pending_confirmation' && replaced.mapping.fingerprint) {
        const nextFingerprints = Array.from(new Set([...pendingFingerprints, replaced.mapping.fingerprint]));
        setPendingFingerprints(nextFingerprints);
        await refreshPendingMappings(nextFingerprints);
      }

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

  return (
    <AppShell>
    <div className="min-h-screen bg-cream p-8 font-sans">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 font-serif text-4xl text-deep-violet-blue">Upload Sales Data</h1>
        <p className="mb-8 font-sans text-deep-violet-blue/80">
          Upload your offline retailer sales data files to get started
        </p>

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
                    {item.mapping?.status === 'pending_confirmation' && (
                      <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                        New mapping needs review
                      </span>
                    )}
                    {item.mapping?.status === 'mapped' && (
                      <span className="ml-2 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900">
                        Matched an existing mapping -- nothing to review
                      </span>
                    )}
                    {item.mapping?.status === 'mapping_failed' && (
                      <span className="ml-2 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-900">
                        Mapping proposal failed{item.mapping.error ? `: ${item.mapping.error}` : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mappingSaveMessage && (
          <p className="mt-6 rounded-md border border-violet bg-lavander p-3 text-sm text-deep-violet-blue">
            {mappingSaveMessage}
          </p>
        )}

        {!!pendingMappingReviews.length && (
          <div className="mt-6">
            <MappingSection section={PENDING_SECTION} count={pendingMappingReviews.length}>
              {pendingMappingReviews.map((mapping) => (
                <MappingReview
                  key={mapping.mappingId}
                  mapping={mapping}
                  isEditing
                  isExpanded
                  onSourceChange={handleMappingSourceChange}
                  onConfirm={confirmMapping}
                  onDiscard={discardMapping}
                  disabled={isUploading}
                />
              ))}
            </MappingSection>
          </div>
        )}
      </div>
    </div>
    </AppShell>
  );
}