'use client';

import { useState } from 'react';

// Collects one or more files and hands them to the parent for upload. Owns only
// the file selection and its validation message; the upload request + loading
// state live in MappingHarness.
export default function UploadPanel({ onUpload, isUploading, showWhitespace, onToggleWhitespace }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [validationMessage, setValidationMessage] = useState('');

  const handleFileChange = (event) => {
    setSelectedFiles(Array.from(event.target.files || []));
    setValidationMessage('');
  };

  const handleUploadClick = () => {
    if (!selectedFiles.length) {
      setValidationMessage('Pick at least one file first.');
      return;
    }
    setValidationMessage('');
    onUpload(selectedFiles);
  };

  return (
    <section className="mb-8 rounded-lg border border-lavander bg-white p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="font-serif text-2xl text-deep-violet-blue">Upload</h2>
        <p className="text-sm text-deep-violet-blue/80">
          Uploads go to <span className="font-mono">uploads/</span> and a contract is proposed for
          each file. Upload the same file twice and the second result comes back mapped from cache,
          with no model call.
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          type="file"
          multiple
          accept=".xlsx,.xlsm,.csv,.txt"
          onChange={handleFileChange}
          disabled={isUploading}
          className="text-sm text-deep-violet-blue file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-lavander file:bg-cream file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-deep-violet-blue disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleUploadClick}
          disabled={isUploading}
          className="rounded-md border border-deep-violet-blue bg-deep-violet-blue px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUploading ? 'Uploading…' : 'Upload files'}
        </button>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-deep-violet-blue/80">
        <input
          type="checkbox"
          checked={showWhitespace}
          onChange={(event) => onToggleWhitespace(event.target.checked)}
        />
        Reveal spaces in column names
      </label>

      {validationMessage && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {validationMessage}
        </p>
      )}
    </section>
  );
}