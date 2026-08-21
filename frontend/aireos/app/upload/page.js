'use client';

import { useState } from 'react';
import FileUpload from '../components/upload/FileUpload';

export default function UploadPage() {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

const backendApiUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL;

  const handleUpload = async (files) => {
    setUploadedFiles(files);
    setUploadResult(null);

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
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', file);
      });

      const response = await fetch(`${backendApiUrl}/api/uploads`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => null);

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

      setUploadResult({
        success: Boolean(data?.success),
        uploaded: data?.uploaded ?? 0,
        failed: data?.failed ?? 0,
        results: Array.isArray(data?.results) ? data.results : [],
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-stone-50 dark:from-slate-900 dark:to-slate-800 p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold text-slate-900 dark:text-amber-50 mb-2">
          Upload Sales Data
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-8">
          Upload your offline retailer sales data files to get started
        </p>

        <FileUpload onUpload={handleUpload} disabled={isUploading} />

        {uploadedFiles.length > 0 && (
          <div className="mt-8 p-6 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded-lg">
            <h2 className="text-lg font-semibold text-green-900 dark:text-green-100 mb-4">
              ✓ Selected ({uploadedFiles.length} file{uploadedFiles.length > 1 ? 's' : ''})
            </h2>
            <ul className="space-y-2">
              {uploadedFiles.map((file) => (
                <li key={file.name} className="text-green-800 dark:text-green-200">
                  {file.name} ({(file.size / 1024).toFixed(2)} KB)
                </li>
              ))}
            </ul>
          </div>
        )}

        {uploadResult && (
          <div
            className={`mt-6 p-6 rounded-lg border ${
              uploadResult.success
                ? 'bg-green-50 dark:bg-green-900/40 border-green-200 dark:border-green-700'
                : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700'
            }`}
          >
            <h2
              className={`text-lg font-semibold mb-3 ${
                uploadResult.success ? 'text-green-900 dark:text-green-100' : 'text-red-900 dark:text-red-100'
              }`}
            >
              {uploadResult.success ? 'Upload completed' : 'Upload completed with errors'}
            </h2>

            <p className="text-sm text-slate-700 dark:text-slate-200 mb-4">
              Uploaded: {uploadResult.uploaded} | Failed: {uploadResult.failed}
            </p>

            {uploadResult.message && (
              <p className="text-sm text-red-700 dark:text-red-200 mb-3">{uploadResult.message}</p>
            )}

            {!!uploadResult.results.length && (
              <ul className="space-y-2">
                {uploadResult.results.map((item, index) => (
                  <li
                    key={`${item.filename || 'file'}-${index}`}
                    className={`rounded-md p-3 text-sm ${
                      item.success
                        ? 'bg-white/70 dark:bg-slate-800 text-green-800 dark:text-green-200'
                        : 'bg-white/70 dark:bg-slate-800 text-red-800 dark:text-red-200'
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
}