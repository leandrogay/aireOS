// The checks a mapping was run through on its example file (backend
// mapping_checks.run_checks): each says whether the output agrees with the
// file's own totals, the period it states, and the business rules. Pure
// helpers for showing them, most serious first.

const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };

/** Failed errors, then failed warnings, then everything that passed. */
export function sortChecks(checks) {
  return [...(checks || [])].sort(
    (a, b) => Number(a.passed) - Number(b.passed) || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level],
  );
}

/** How many checks failed, warned and passed. */
export function checkSummary(checks) {
  const list = checks || [];
  return {
    failed: list.filter((check) => !check.passed && check.level === 'error').length,
    warnings: list.filter((check) => !check.passed && check.level === 'warning').length,
    passed: list.filter((check) => check.passed).length,
  };
}

function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return 'none';
    return entries
      .map(([key, inner]) => `${key}: ${typeof inner === 'object' && inner !== null ? JSON.stringify(inner) : formatValue(inner)}`)
      .join('; ');
  }
  return String(value);
}

/**
 * A failed check's evidence as "label: value" lines, leaving out what is
 * empty, so a reviewer sees the numbers that disagree and nothing else.
 */
export function evidenceLines(evidence) {
  return Object.entries(evidence || {})
    .filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    })
    .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${formatValue(value)}`);
}
