import { matchesSearch } from '@/app/utils/tableView';

// Mapping state as something a person reads. Anything unrecognised falls
// through to the raw value rather than being hidden. Keys are the `state` of
// a backend mapping_view packet.
export const MAPPING_STATE_LABELS = {
  confirmed: { tone: 'ready', label: 'Confirmed' },
  pending: { tone: 'review', label: 'Needs review' },
};

export const MAPPING_STATUS_OPTIONS = Object.entries(MAPPING_STATE_LABELS).map(
  ([value, { label }]) => ({ value, label }),
);

// Values match mappingIssueKind().
export const MAPPING_ISSUE_OPTIONS = [
  { value: 'missing', label: 'Required fields missing' },
  { value: 'warnings', label: 'Warnings' },
  { value: 'none', label: 'No issues' },
];

/**
 * What, if anything, stops this mapping being used as-is. Missing required
 * fields outrank warnings, as they do in issueSummary().
 *
 * @param {object} mapping
 * @returns {'missing' | 'warnings' | 'none'}
 */
export function mappingIssueKind(mapping) {
  if (mapping.requiredMissing?.length) return 'missing';
  if (mapping.warnings?.length) return 'warnings';
  return 'none';
}

/**
 * One line for the Issues column, or null when there is nothing to say.
 *
 * @param {object} mapping
 * @returns {string | null}
 */
export function issueSummary(mapping) {
  const missing = mapping.requiredMissing?.length || 0;
  const warnings = mapping.warnings?.length || 0;

  if (missing) return `${missing} required field${missing === 1 ? '' : 's'} missing`;
  if (warnings) return `${warnings} warning${warnings === 1 ? '' : 's'}`;
  return null;
}

/**
 * The name shown in the Vendor column. A built-in mapping has no vendor but
 * may name its retailer family.
 *
 * @param {object} mapping
 * @returns {string}
 */
export function mappingVendor(mapping) {
  return mapping.vendor || mapping.retailerFamily || '';
}

/**
 * Distinct vendors across the list, A–Z, for the Vendor filter.
 *
 * @param {object[]} mappings
 * @returns {string[]}
 */
export function uniqueMappingVendors(mappings) {
  const vendors = new Set(mappings.map(mappingVendor).filter(Boolean));
  return [...vendors].sort((a, b) => a.localeCompare(b));
}

/**
 * Mappings that pass every filter that is set. An empty value means "all".
 *
 * @param {object[]} mappings
 * @param {{ vendor: string, status: string, issues: string }} filters
 * @returns {object[]}
 */
export function filterMappings(mappings, filters) {
  return mappings.filter(
    (mapping) =>
      (!filters.vendor || mappingVendor(mapping) === filters.vendor) &&
      (!filters.status || mapping.state === filters.status) &&
      (!filters.issues || mappingIssueKind(mapping) === filters.issues),
  );
}

/**
 * Mappings whose name, example file name or vendor contains the query.
 *
 * @param {object[]} mappings
 * @param {string} query
 * @returns {object[]}
 */
export function searchMappings(mappings, query) {
  return mappings.filter((mapping) =>
    matchesSearch([mapping.name, mapping.filename, mappingVendor(mapping)], query),
  );
}

/**
 * Mappings ordered A–Z (or Z–A) on the Mapping or Vendor column. With no sort
 * field the backend's order is kept: confirmed mappings first, then
 * proposals. Blank values sort last either way, so unnamed proposals never
 * crowd the top of the list.
 *
 * @param {object[]} mappings
 * @param {'name' | 'vendor' | null} field
 * @param {'asc' | 'desc'} direction
 * @returns {object[]}
 */
export function sortMappings(mappings, field, direction) {
  if (!field) return mappings;
  const valueOf = field === 'vendor' ? mappingVendor : (mapping) => mapping.name || '';
  const sign = direction === 'asc' ? 1 : -1;

  return [...mappings].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    if (!left || !right) return Number(!left) - Number(!right);
    return sign * left.localeCompare(right);
  });
}
