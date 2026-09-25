// ============================================================
// Backend calls for the upload page.
// Each exported function is annotated with its HTTP method + endpoint.
// ============================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL;

// Listing the bucket is several round trips, so this is a floor for "the
// backend is not answering", not a latency budget.
const HISTORY_TIMEOUT_MS = 20000;

function describeNetworkFailure(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return `No response from the backend at ${API_BASE}. Check that it is running.`;
  }
  return (
    'Unable to reach the backend upload service. ' +
    'Check NEXT_PUBLIC_API_URL, server status, and CORS settings.'
  );
}

async function readError(response) {
  const data = await response.json().catch(() => null);
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail?.message) return detail.message;
  return `Upload failed (HTTP ${response.status}).`;
}

// ========================================
// API CALL
// POST /api/uploads
// Uploads one file as multipart/form-data (field name "files" — the endpoint
// takes a list, and one file is a list of one).
//
// One request per file is deliberate: the endpoint uploads, dedupes, resolves
// a mapping and applies it in a single synchronous call, so batching them puts
// every file behind the slowest one and a single failure lands on all of them.
// Per file, each gets its own result and its own progress.
//
// `force` replaces a previous upload of the same file; `keepDuplicate` keeps
// both copies. They are different answers to a duplicate, so they stay
// separate flags rather than one "ignore the check" switch.
// ========================================
export async function uploadFile(file, { force = false, keepDuplicate = false, signal } = {}) {
  const formData = new FormData();
  formData.append('files', file);
  formData.append('force', force ? 'true' : 'false');
  formData.append('keep_duplicate', keepDuplicate ? 'true' : 'false');

  let response;
  try {
    response = await fetch(`${API_BASE}/api/uploads`, {
      method: 'POST',
      body: formData,
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(describeNetworkFailure(error));
  }

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = await response.json().catch(() => null);
  const result = data?.results?.[0];

  if (!result) {
    throw new Error('The server accepted the upload but returned no result for it.');
  }

  return result;
}

// ========================================
// API CALL
// GET /api/uploads/history
// Recent uploads, newest first: filename, vendor, date, and the mapping each
// file was run through.
// ========================================
export async function fetchUploadHistory(limit = 25) {
  let response;
  try {
    response = await fetch(`${API_BASE}/api/uploads/history?limit=${limit}`, {
      signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(describeNetworkFailure(error));
  }

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const data = await response.json().catch(() => null);
  return Array.isArray(data?.uploads) ? data.uploads : [];
}
