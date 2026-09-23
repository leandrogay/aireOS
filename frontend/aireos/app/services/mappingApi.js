// ============================================================
// All backend communication for the mapping harness lives here.
// Each exported function is annotated with its HTTP method + endpoint.
// ============================================================

// Shared fetch wrapper — mirrors the harness's api() helper: logs the request,
// parses the body as JSON when possible, and throws an Error carrying
// { status, data } so callers can surface server-provided detail. `onLog` is
// the log callback from MappingHarness (kind: 'req' | 'res' | 'er').
async function request(baseUrl, path, { method = 'GET', body, headers, onLog } = {}) {
  const url = `${baseUrl}${path}`;
  onLog?.('req', `${method} ${url}`);

  try {
    const response = await fetch(url, { method, body, headers });
    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!response.ok) {
      onLog?.(
        'er',
        `${response.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`,
      );
      const error = new Error(
        typeof data === 'string' ? data : JSON.stringify(data?.detail ?? data),
      );
      error.status = response.status;
      error.data = data;
      throw error;
    }

    onLog?.(
      'res',
      `${response.status} ${text.slice(0, 400)}${text.length > 400 ? ' …' : ''}`,
    );
    return data;
  } catch (error) {
    // Only network/CORS failures reach here without a status.
    if (!error.status) {
      onLog?.(
        'er',
        `Request failed: ${error.message} — check the API base URL, that the server is running, and that CORS allows this origin.`,
      );
    }
    throw error;
  }
}

// ========================================
// API CALL
// POST /api/uploads
// Uploads one or more source files as multipart/form-data (field name "files").
// ========================================
export async function uploadFiles(baseUrl, files, onLog) {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  return request(baseUrl, '/api/uploads', { method: 'POST', body: formData, onLog });
}

// ========================================
// API CALL
// GET /api/mappings
// Every stored mapping in the review shape: the builtin rule set, then
// confirmed contracts, then proposals awaiting approval.
// ========================================
export async function listMappings(baseUrl, onLog) {
  return request(baseUrl, '/api/mappings', { onLog });
}

// ========================================
// API CALL
// POST /api/mappings/:fingerprint/confirm
// Approves a mapping and saves it for reuse. Body takes { rules } (what the
// review screen edits), and { name, vendor }, which are required the first
// time a mapping is approved.
// ========================================
export async function confirmMapping(baseUrl, fingerprint, body, onLog) {
  return request(baseUrl, `/api/mappings/${encodeURIComponent(fingerprint)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    onLog,
  });
}

// ========================================
// API CALL
// DELETE /api/mappings/:fingerprint/pending
// Discards a pending proposal so the next upload regenerates it.
// ========================================
export async function discardMapping(baseUrl, fingerprint, onLog) {
  return request(baseUrl, `/api/mappings/${encodeURIComponent(fingerprint)}/pending`, {
    method: 'DELETE',
    onLog,
  });
}

// ========================================
// API CALL
// GET /api/mappings/:fingerprint
// One stored mapping (confirmed or pending) in the review shape, plus the raw
// `contract` it was built from.
// ========================================
export async function lookupMapping(baseUrl, fingerprint, onLog) {
  return request(baseUrl, `/api/mappings/${encodeURIComponent(fingerprint)}`, {
    method: 'GET',
    onLog,
  });
}

// ========================================
// API CALL
// POST /api/mappings/:fingerprint/preview
// Runs the mapping's example file through a set of rules and returns a few
// output rows. Pass the edited rules to see a change before approving it.
// ========================================
export async function previewMapping(baseUrl, fingerprint, body, onLog) {
  return request(baseUrl, `/api/mappings/${encodeURIComponent(fingerprint)}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    onLog,
  });
}