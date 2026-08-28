// Returns the API base with trailing slashes removed, matching the harness's
// base() behaviour (request paths always start with a leading slash).
export function normalizeBaseUrl(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

// Runs a melt group's period-extraction regex against a sample column name and
// returns what capture group 1 pulls out, so a wrong capture group is visible
// before approval. JS and Python regex differ, so an invalid pattern is
// reported rather than thrown.
export function previewExtraction(regexSource, sample) {
  try {
    const match = new RegExp(regexSource).exec(sample);
    return match && match[1] != null ? match[1] : 'no match';
  } catch {
    return 'regex not valid in JS (may still be valid in Python)';
  }
}