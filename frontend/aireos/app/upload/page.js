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
              Uploaded: {uploadResult.uploaded} | Failed: {uploadResult.failed}
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
}