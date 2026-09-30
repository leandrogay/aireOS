// Returns the API base with trailing slashes removed: request paths always
// start with a leading slash, so a trailing one would double it.
export function normalizeBaseUrl(url) {
  return String(url ?? '').replace(/\/+$/, '');
}
