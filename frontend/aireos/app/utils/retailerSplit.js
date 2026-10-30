import { currentDecision, rowsAboveChoices } from '@/app/utils/fieldDecision';
import { channelRetailerName } from '@/app/utils/mappingCustomer';
import { HEADING_FIELDS, fieldLabel } from '@/app/utils/mappingReview';
import { ruleMatches } from '@/app/utils/transformSteps';

// The retailer as the dashboard reads it: the customer's name with _online or
// _offline behind it (backend sellout_service _retailer_for). A file says
// which rows are online in its own words -- an outlet called ONLINE, a code
// ending _Ecomm, a store format FPON -- so the review asks only that: where
// to look and what marks a row online. The retailer names themselves always
// come from the customer, so they can never be another customer's or a raw
// value. Pure: no React.

const CHANNEL_SUFFIX = /_(online|offline)$/;

// Words that mark an online outlet in the files seen so far, offered as a
// first guess. The reviewer decides.
const ONLINE_WORDS = ['online', 'ecomm', 'e-comm', 'web'];

/** 'online' or 'offline' for a channel retailer name, else null. */
export function channelOf(retailerName) {
  return CHANNEL_SUFFIX.exec(String(retailerName || ''))?.[1] || null;
}

function asList(transforms) {
  if (Array.isArray(transforms)) return transforms;
  return transforms && typeof transforms === 'object' ? [transforms] : [];
}

// ============================================================
// Where the online / offline split can be read from
// ============================================================

/**
 * The values a field takes in the example file, as far as the screen knows:
 * its column's values, its group's headings, or the cells over them. `partial`
 * when only a spread of them is known (a column with many values).
 */
function fieldValues(mapping, state, layout, field) {
  const decision = currentDecision(mapping, state, field);
  if (decision.method === 'column') return columnValues(mapping, decision.column);
  const columns = state.groups[0]?.columns || [];
  if (decision.method === 'headings') return { values: columns, partial: false };
  if (decision.method === 'above') {
    const row = rowsAboveChoices(layout, columns).find((item) => item.rowsAbove === decision.rowsAbove);
    return row ? { values: columns.map((column) => row.cells[column]).filter(Boolean), partial: false } : null;
  }
  return null;
}

function columnValues(mapping, column) {
  const profiled = mapping?.columnValues?.[column];
  if (profiled) return { values: profiled.values, partial: profiled.distinct > profiled.values.length };
  const samples = mapping?.columnSamples?.[column] || [];
  return { values: samples, partial: true };
}

/**
 * Every field or column the split can be read from, with its values: the
 * descriptive fields filled from the file (store name, store code…, read from
 * a column, the headings or a row above them), then every column of the file.
 *
 * @returns {{ value: string, label: string, values: string[], partial: boolean }[]}
 */
export function splitSources(mapping, state, layout) {
  const fields = HEADING_FIELDS.filter((field) => field !== 'retailer')
    .map((field) => ({ field, read: fieldValues(mapping, state, layout, field) }))
    .filter((item) => item.read?.values.length)
    .map(({ field, read }) => ({ value: `field:${field}`, label: fieldLabel(field), ...read }));
  const inGroups = new Set(state.groups.flatMap((group) => group.columns));
  const columns = (mapping?.columns || [])
    .filter((column) => !inGroups.has(column))
    .map((column) => ({ value: `column:${column}`, label: `Column “${column}”`, ...columnValues(mapping, column) }))
    .filter((item) => item.values.length);
  return [...fields, ...columns];
}

/** The online rule of a split, as a rules transform writing the customer's retailers. */
function splitRules(matches, customerName) {
  return [
    {
      type: 'rules',
      rules: matches
        .filter((match) => String(match.value).trim())
        .map((match) => ({ op: match.op, value: match.value.trim(), output: channelRetailerName(customerName, 'online') })),
      default: channelRetailerName(customerName, 'offline'),
      case_sensitive: false,
    },
  ];
}

/** Which of a source's values a split sends online, and which offline. */
export function splitPreview(values, matches) {
  const usable = matches.filter((match) => String(match.value).trim());
  const online = [];
  const offline = [];
  [...new Set(values.map(String))].forEach((value) => {
    const hit = usable.some((match) => ruleMatches({ ...match, value: match.value.trim() }, value, false));
    (hit ? online : offline).push(value);
  });
  return { online, offline };
}

/**
 * A first guess at the split: the first source with a value that names an
 * online channel, matched on that word. Null when nothing looks online.
 */
export function suggestSplit(sources) {
  for (const source of sources) {
    for (const word of ONLINE_WORDS) {
      if (source.values.some((value) => String(value).toLowerCase().includes(word))) {
        return { mode: 'split', source: source.value, matches: [{ op: 'contains', value: word }] };
      }
    }
  }
  return null;
}

// ============================================================
// From and to the retailer decision
// ============================================================

/**
 * The retailer decision (mappingCustomer.retailerDecision) as a split, when
 * it is one: every row to one channel, or rules sending matching rows online
 * and the rest offline. Anything else -- a code table, rules writing other
 * names -- is 'custom', and stays editable rule by rule.
 *
 * @returns {{ mode: 'offline' | 'online' | 'split' | 'custom' | 'none', source?: string, matches?: object[] }}
 */
export function splitFromDecision(decision) {
  if (decision.kind === 'none' || decision.status === 'not_available' || decision.status === 'unmapped') {
    return { mode: 'none' };
  }
  if (decision.status === 'constant') {
    const channel = channelOf(decision.value);
    return channel ? { mode: channel } : { mode: 'custom' };
  }
  const [only, ...more] = decision.transforms;
  if (only?.type === 'rules' && !more.length) {
    const rules = only.rules || [];
    const online = rules.length > 0 && rules.every((rule) => channelOf(rule.output) === 'online');
    if (online && channelOf(only.default) === 'offline') {
      const source =
        decision.kind === 'column'
          ? `column:${decision.column}`
          : decision.entry?.from_field
            ? `field:${decision.entry.from_field}`
            : '';
      return { mode: 'split', source, matches: rules.map((rule) => ({ op: rule.op, value: rule.value })) };
    }
  }
  return { mode: 'custom' };
}

/**
 * The retailer field decision (fieldDecision shape) a split stands for, with
 * the customer's channel retailers as what it writes.
 */
export function splitDecision(split, customerName) {
  if (split.mode === 'offline' || split.mode === 'online') {
    return { method: 'constant', value: channelRetailerName(customerName, split.mode) };
  }
  const transforms = splitRules(split.matches, customerName);
  const [kind, ...rest] = split.source.split(':');
  const name = rest.join(':');
  return kind === 'column'
    ? { method: 'column', column: name, transforms }
    : { method: 'derived', fromField: name, transforms };
}

/** Why a split cannot be used yet, or ''. */
export function splitProblem(split) {
  if (split.mode !== 'split') return '';
  if (!split.source) return 'Choose where to look.';
  if (!split.matches.some((match) => String(match.value).trim())) return 'Say what marks a row online.';
  return '';
}

// ============================================================
// Another customer's names
// ============================================================

/**
 * The channel retailers a decision writes that are not this customer's --
 * names of the right shape (…_online, …_offline) for another customer, as a
 * proposal made before the customer was chosen writes them.
 */
export function foreignChannels(outputs, customerName) {
  return (outputs || []).filter(
    (name) => channelOf(name) && name !== channelRetailerName(customerName, channelOf(name)),
  );
}

/**
 * The retailer decision with every channel retailer it writes renamed to the
 * customer's, keeping where it looks and what it matches. Null when the
 * decision cannot be rewritten that way (read from the headings as they are).
 */
export function withCustomerChannels(decision, customerName) {
  const rename = (name) => (channelOf(name) ? channelRetailerName(customerName, channelOf(name)) : name);
  if (decision.status === 'constant') return { method: 'constant', value: rename(decision.value) };

  const transforms = asList(decision.transforms).map((transform) => {
    if (transform.type === 'rules') {
      return {
        ...transform,
        rules: (transform.rules || []).map((rule) => ({ ...rule, output: rename(rule.output) })),
        ...(transform.default ? { default: rename(transform.default) } : {}),
      };
    }
    if (transform.type === 'value_map') {
      return {
        ...transform,
        values: Object.fromEntries(Object.entries(transform.values || {}).map(([from, to]) => [from, rename(to)])),
        ...(transform.default ? { default: rename(transform.default) } : {}),
      };
    }
    return transform;
  });
  if (decision.kind === 'column') return { method: 'column', column: decision.column, transforms };
  if (decision.entry?.from_field) return { method: 'derived', fromField: decision.entry.from_field, transforms };
  return null;
}
