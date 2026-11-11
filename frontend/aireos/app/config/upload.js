// Upload limits, in one place because they are stated in three: the text under
// the dropzone, the client-side validation that rejects a file, and the error
// message explaining why.
//
// The backend accepts .xlsm too (backend/app/services/storage.py
// ALLOWED_EXTENSIONS) and enforces no size limit of its own — these are the
// narrower product rules, not a mirror of the server's.
//
// The size cap is set by Cloud Run, not the app: a request body over 32 MiB is
// rejected before it reaches FastAPI, so the limit stays under that, with room
// for the multipart overhead around the file.

export const MAX_FILES_PER_BATCH = 10;

export const MAX_FILE_SIZE_MB = 30;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const ALLOWED_EXTENSIONS = ['xlsx', 'csv', 'txt'];

// For the file input's accept attribute: ".xlsx,.csv,.txt"
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export const UPLOAD_LIMITS_TEXT =
  `Up to ${MAX_FILES_PER_BATCH} files per batch · ` +
  `${ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(', ')} · ` +
  `max ${MAX_FILE_SIZE_MB} MB each`;

// How many Recent uploads rows are fetched at once; the table pages through
// them locally (utils/tableView.js blockQuery). The backend's largest `limit`
// (routers/uploads.py upload_history), and a multiple of every page size in
// ui/TablePagination PAGE_SIZES, so a page never straddles two blocks.
export const UPLOAD_HISTORY_BLOCK = 100;
