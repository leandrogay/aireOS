'use client';

import { useEffect, useRef, useState } from 'react';
import {
  uploadFiles,
  confirmMapping,
  discardMapping,
  lookupMapping,
} from '../../services/mappingHarnessApi';
import { normalizeBaseUrl } from '../../utils/mappingHarnessHelpers';
import { WhitespaceProvider } from './whitespaceContext';
import ApiBaseInput from './ApiBaseInput';
import UploadPanel from './UploadPanel';
import ResultsPanel from './ResultsPanel';
import FingerprintLookup from './FingerprintLookup';
import RequestLog from './RequestLog';

// Initial API base: the same env fallback the rest of the app uses, still
// fully editable in the Connection panel.
const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8000';

// Top-level container. Owns the API base, upload results, request log, and the
// whitespace toggle, and is the single place backend calls are initiated
// (through services/mappingHarnessApi.js).
export default function MappingHarness() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [results, setResults] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [logLines, setLogLines] = useState([]);

  const logIdRef = useRef(0);
  const didInitRef = useRef(false);

  // Appends a line to the request log (kind: 't' | 'req' | 'res' | 'er').
  const log = (kind, text) => {
    const id = logIdRef.current;
    logIdRef.current += 1;
    setLogLines((prev) => [
      ...prev,
      { id, time: new Date().toTimeString().slice(0, 8), kind, text },
    ]);
  };

  // Seed the "Ready" line on the client only, so the timestamp doesn't cause an
  // SSR/hydration mismatch.
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    setLogLines([
      {
        id: 0,
        time: new Date().toTimeString().slice(0, 8),
        kind: 't',
        text: 'Ready. Set the API base above, then upload a file.',
      },
    ]);
    logIdRef.current = 1;
  }, []);

  // Current API base with trailing slashes stripped, evaluated per request.
  const apiBaseForRequest = () => normalizeBaseUrl(apiBase);

  // --- upload ---
  const handleUpload = async (files) => {
    setUploadError('');
    setIsUploading(true);
    try {
      const data = await uploadFiles(apiBaseForRequest(), files, log);
      setResults(data);
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClearResults = () => {
    setResults(null);
    setUploadError('');
  };

  // --- review actions (called by ReviewControls; resolve to the raw response) ---
  const handleConfirm = (fingerprint, body) =>
    confirmMapping(apiBaseForRequest(), fingerprint, body, log);

  const handleDiscard = (fingerprint) =>
    discardMapping(apiBaseForRequest(), fingerprint, log);

  // --- lookup (called by FingerprintLookup) ---
  const handleLookup = (fingerprint) =>
    lookupMapping(apiBaseForRequest(), fingerprint, log);

  // --- whitespace toggle ---
  const handleToggleWhitespace = (next) => {
    setShowWhitespace(next);
    log('t', `Whitespace display ${next ? 'on' : 'off'}.`);
  };

  return (
    <div className="min-h-screen bg-cream p-8 font-sans">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 font-serif text-4xl text-deep-violet-blue">Uploads 2</h1>
        <p className="mb-8 font-sans text-deep-violet-blue/80">
          Upload retailer sales files, review the proposed column mapping, and approve, edit, or
          discard it.
        </p>

        <WhitespaceProvider value={showWhitespace}>
          {/* <ApiBaseInput apiBase={apiBase} onApiBaseChange={setApiBase} /> */}

          <UploadPanel
            onUpload={handleUpload}
            isUploading={isUploading}
            showWhitespace={showWhitespace}
            onToggleWhitespace={handleToggleWhitespace}
          />

          <ResultsPanel
            results={results}
            uploadError={uploadError}
            onClear={handleClearResults}
            onConfirm={handleConfirm}
            onDiscard={handleDiscard}
          />

          {/* <FingerprintLookup onLookup={handleLookup} /> */}

          {/* <RequestLog lines={logLines} /> */}
        </WhitespaceProvider>
      </div>
    </div>
  );
}