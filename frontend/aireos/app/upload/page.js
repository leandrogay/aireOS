'use client';

import { useState } from 'react';
import FileUpload from '../components/upload/FileUpload';
import { MappingReview } from '../components/upload/MappingReview';

const REQUIRED_TARGET_FIELDS = ['sku', 'quantity_units', 'revenue', 'period_start'];

const BASE_SUGGESTIONS = [
  { sourceColumn: 'SKU', targetField: 'sku', confidence: 0.97 },
  { sourceColumn: 'Product Name', targetField: 'product_name', confidence: 0.95 },
  { sourceColumn: 'Qty Sold', targetField: 'quantity_units', confidence: 0.89 },
  { sourceColumn: 'Sales Value', targetField: 'revenue', confidence: 0.92 },
  { sourceColumn: 'Week Start', targetField: 'period_start', confidence: 0.86 },
  { sourceColumn: 'Store', targetField: '', confidence: 0.41 },
];

const withStatuses = (suggestions) =>
  suggestions.map((item) => ({
    ...item,
    status: item.targetField ? 'mapped' : 'unmapped',
  }));

const computeMappingMeta = (suggestions) => {
  const mappedTargets = suggestions.filter((row) => row.targetField).map((row) => row.targetField);
  const unmapped = suggestions.filter((row) => !row.targetField).map((row) => row.sourceColumn);
  const requiredMissing = REQUIRED_TARGET_FIELDS.filter((field) => !mappedTargets.includes(field));
  return { unmapped, requiredMissing };
};

const createFixtureMapping = (file, index) => {
  const rawSuggestions = BASE_SUGGESTIONS.map((item) => ({ ...item }));

  if (index % 2 === 1) {
    rawSuggestions[3] = { ...rawSuggestions[3], targetField: '', confidence: 0.43 };
    rawSuggestions.push({ sourceColumn: 'Retailer Code', targetField: 'retailer', confidence: 0.72 });
  }

  const suggestions = withStatuses(rawSuggestions);
  const { unmapped, requiredMissing } = computeMappingMeta(suggestions);

  return {
    mappingId: `fixture-${index + 1}`,
    filename: file.name,
    columns: suggestions.map((row) => row.sourceColumn),
    suggestions,
    unmapped,
    requiredMissing,
    validated: false,
    validatedAt: null,
  };
};

export const UploadPage = () => {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [duplicates, setDuplicates] = useState([]);
  const [mappingReviews, setMappingReviews] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const backendApiUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL;

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
    setMappingReviews(files.map((file, index) => createFixtureMapping(file, index)));

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
    } catch (error) {
      setUploadResult({
        success: false,
        uploaded: 0,
        failed: files.length,
        results: [],
        message:
          'Unable to connect to backend upload service. Check BACKEND_API_URL, server status, and CORS settings.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleMappingTargetChange = (mappingId, rowIndex, nextTargetField) => {
    setMappingReviews((prev) =>
      prev.map((mapping) => {
        if (mapping.mappingId !== mappingId) return mapping;

        const suggestions = mapping.suggestions.map((row, index) => {
          if (index !== rowIndex) return row;
          return {
            ...row,
            targetField: nextTargetField,
            status: nextTargetField ? 'mapped' : 'unmapped',
          };
        });

        const { unmapped, requiredMissing } = computeMappingMeta(suggestions);
        return {
          ...mapping,
          suggestions,
          unmapped,
          requiredMissing,
          validated: false,
          validatedAt: null,
        };
      }),
    );
  };

  const handleMappingValidate = (mappingId) => {
    setMappingReviews((prev) =>
      prev.map((mapping) => {
        if (mapping.mappingId !== mappingId) return mapping;
        return {
          ...mapping,
          validated: true,
          validatedAt: new Date().toISOString(),
        };
      }),
    );
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

  return (
    <div className="min-h-screen bg-cream p-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-serif text-4xl text-deep-violet-blue mb-2">
          Upload Sales Data
        </h1>
        <p className="font-sans text-deep-violet-blue/80 mb-8">
          Upload your offline retailer sales data files to get started
        </p>

        <FileUpload onUpload={handleUpload} disabled={isUploading} />

        {uploadedFiles.length > 0 && (
          <div className="mt-8 p-6 bg-green-50 border border-green-200 rounded-lg">
            <h2 className="font-serif text-lg text-green-900 mb-4">
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

        {mappingReviews.map((mapping) => (
          <MappingReview
            key={mapping.mappingId}
            mapping={mapping}
            onTargetChange={handleMappingTargetChange}
            onValidate={handleMappingValidate}
            disabled={isUploading}
          />
        ))}

        {duplicates.length > 0 && (
          <div className="mt-6 p-6 bg-yellow-50 border border-yellow-300 rounded-lg">
            <h2 className="font-serif text-lg text-yellow-900 mb-2">
              Possible duplicate{duplicates.length > 1 ? 's' : ''} detected
            </h2>
            <p className="text-sm text-yellow-800 mb-4">
              These filenames were already uploaded before. Uploading again would double-count
              sales unless you replace the existing file.
            </p>
            <ul className="space-y-3">
              {duplicates.map((dup) => (
                <li
                  key={dup.id}
                  className="flex flex-col gap-2 rounded-md bg-white border border-yellow-200 p-3 text-sm text-yellow-900 md:flex-row md:items-center md:justify-between"
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
            className={`mt-6 p-6 rounded-lg border ${
              uploadResult.success
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <h2
              className={`font-serif text-lg mb-3 ${
                uploadResult.success ? 'text-green-900' : 'text-red-900'
              }`}
            >
              {uploadResult.success ? 'Upload completed' : 'Upload completed with errors'}
            </h2>

            <p className="text-sm text-deep-violet-blue mb-4">
              Uploaded: {uploadResult.uploaded}
              {uploadResult.duplicates ? ` | Duplicates pending: ${uploadResult.duplicates}` : ''}
              {' | '}Failed: {uploadResult.failed}
            </p>

            {uploadResult.message && (
              <p className="text-sm text-red-700 mb-3">{uploadResult.message}</p>
            )}

            {!!uploadResult.results.length && (
              <ul className="space-y-2">
                {uploadResult.results.map((item, index) => (
                  <li
                    key={`${item.filename || 'file'}-${index}`}
                    className={`rounded-md p-3 text-sm ${
                      item.success
                        ? 'bg-white text-green-800'
                        : 'bg-white text-red-800'
                    }`}
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
  );
};

export default UploadPage;