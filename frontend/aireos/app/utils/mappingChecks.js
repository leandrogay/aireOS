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

/**
 * The failed required_<field> checks (backend mapping_checks), one per field,
 * folded into one: they all say the same thing, and a blank proposal fails
 * five of them at once. Everything else is returned as it was.
 *
 * @param {object[]} checks
 * @param {(field: string) => string} labelOf the name a reviewer knows a field by
 */
export function groupRequiredChecks(checks, labelOf = (field) => field) {
  const list = checks || [];
  const missing = list.filter((check) => !check.passed && check.level === 'error' && check.id?.startsWith('required_'));
  if (missing.length < 2) return list;
  const fields = missing.flatMap((check) => check.fields || []);
  const merged = {
    id: 'required_fields',
    level: 'error',
    passed: false,
    message: `${missing.length} required fields have no source yet: ${fields.map(labelOf).join(', ')}.`,
    fields,
    evidence: {},
  };
  const firstAt = list.indexOf(missing[0]);
  const rest = list.filter((check) => !missing.includes(check));
  return [...rest.slice(0, firstAt), merged, ...rest.slice(firstAt)];
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
