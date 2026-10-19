import { matchesSearch } from '@/app/utils/tableView';
import { retailerLabel, vendorLabel } from '@/app/utils/retailerLabel';

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
 * What a mapping is called in a list or a heading. A proposal has no name
 * until it is approved, so it is known by the file it was proposed for.
 *
 * @param {object} mapping
 * @returns {string}
 */
export function mappingTitle(mapping) {
  if (mapping.name) return mapping.name;
  const file = mapping.sourceFilename || String(mapping.filename || '').split('/').pop();
  return file ? `New layout from ${file}` : 'New layout';
}

/**
 * The name shown in the Customer column: the linked customer, else the
 * free-text vendor a mapping approved before customers existed was saved
 * under.
 *
 * @param {object} mapping
 * @returns {string}
 */
export function mappingCustomer(mapping) {
  return retailerLabel(mapping.customerName) || vendorLabel(mapping.vendor) || mapping.retailerFamily || '';
}

/**
 * Distinct customers across the list, A–Z, for the Customer filter.
 *
 * @param {object[]} mappings
 * @returns {string[]}
 */
export function uniqueMappingCustomers(mappings) {
  const customers = new Set(mappings.map(mappingCustomer).filter(Boolean));
  return [...customers].sort((a, b) => a.localeCompare(b));
}

/** Whether a value passes a multi-pick filter: nothing picked lets everything through. */
function picked(selection, value) {
  return !selection?.length || selection.includes(value);
}

/**
 * Mappings that pass every filter that is set. Each filter is a list of the
 * values ticked; an empty list means "all".
 *
 * @param {object[]} mappings
 * @param {{ customer: string[], status: string[], issues: string[] }} filters
 * @returns {object[]}
 */
export function filterMappings(mappings, filters) {
  return mappings.filter(
    (mapping) =>
      picked(filters.customer, mappingCustomer(mapping)) &&
      picked(filters.status, mapping.state) &&
      picked(filters.issues, mappingIssueKind(mapping)),
  );
}

/**
 * Mappings whose name, example file name or customer contains the query.
 *
 * @param {object[]} mappings
 * @param {string} query
 * @returns {object[]}
 */
export function searchMappings(mappings, query) {
  return mappings.filter((mapping) =>
    matchesSearch([mappingTitle(mapping), mapping.filename, mappingCustomer(mapping)], query),
  );
}

/**
 * Mappings ordered A–Z (or Z–A) on the Mapping or Customer column. With no sort
 * field the backend's order is kept: confirmed mappings first, then
 * proposals. Blank values sort last either way, so unnamed proposals never
 * crowd the top of the list.
 *
 * @param {object[]} mappings
 * @param {'name' | 'customer' | null} field
 * @param {'asc' | 'desc'} direction
 * @returns {object[]}
 */
export function sortMappings(mappings, field, direction) {
  if (!field) return mappings;
  const valueOf = field === 'customer' ? mappingCustomer : (mapping) => mapping.name || '';
  const sign = direction === 'asc' ? 1 : -1;

  return [...mappings].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    if (!left || !right) return Number(!left) - Number(!right);
    return sign * left.localeCompare(right);
  });
}
