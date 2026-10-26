import { normaliseName } from '@/app/utils/customerForm';

// The customer a mapping belongs to, and the retailers its file's sales are
// written to. Pure helpers for the review screen, no React.
//
// Sales find their way onto the dashboard through the customer: it looks up
// "{customer}_offline" / "{customer}_online" (backend sellout_service
// _retailer_for). An upload creates any retailer name it meets with no
// customer (catalog_service.get_or_create_retailers), and those sales are
// then on no page. So a mapping names its customer, and every retailer it
// writes to has to be one of that customer's before it can be approved
// (backend mappings._foreign_retailers holds the same rule).

// ============================================================
// Channels
// ============================================================

export const CHANNELS = [
  { value: 'offline', label: 'Offline', help: 'Physical stores' },
  { value: 'online', label: 'Online', help: 'E-commerce' },
];

/** `Giant`, `online` → `giant_online`, the name the dashboard looks up. */
export function channelRetailerName(customerName, channel) {
  return `${normaliseName(customerName)}_${channel}`;
}

/** The customer part of a channel retailer name: `giant_online` → `giant`. */
function retailerFamily(retailerName) {
  return String(retailerName).replace(/_(online|offline)$/, '');
}

// ============================================================
// What the mapping writes to
// ============================================================

function asList(transforms) {
  if (Array.isArray(transforms)) return transforms;
  return transforms && typeof transforms === 'object' ? [transforms] : [];
}

/**
 * How the mapping fills the retailer field, wherever that lives on the
 * screen: on the column that reads it (`kind: 'column'`), or on a decision
 * made without a column, such as NHG's constant (`kind: 'locked'`).
 */
export function retailerDecision(mapping, rows, fieldEdits = {}) {
  for (const row of rows) {
    const field = row.fields.find((item) => item.targetField === 'retailer');
    if (field) {
      return {
        kind: 'column',
        column: row.column,
        status: 'mapped',
        transforms: asList(field.transform),
        samples: row.samples || [],
      };
    }
  }

  const rule = (mapping?.rules || []).find(
    (item) => item.targetField === 'retailer' && item.editable === false && !item.meltGroup,
  );
  const entry = fieldEdits.retailer || rule?.field;
  if (!entry) return { kind: 'none', status: 'unmapped', transforms: [] };
  return { kind: 'locked', status: entry.status, value: entry.value, transforms: asList(entry.transforms), entry };
}

/**
 * Every retailer name the decision writes sales to, or null when that cannot
 * be told without running it. Mirrors backend mapping_contract.retailer_outputs;
 * a column read as it is is judged on its sample values, which the server
 * checks again against the whole file.
 *
 * @returns {string[] | null}
 */
export function retailerOutputs(decision) {
  if (decision.status === 'constant') return decision.value ? [String(decision.value)] : [];
  if (decision.status !== 'mapped' && decision.status !== 'derived') return [];

  const last = decision.transforms.at(-1);
  let outputs;
  if (last?.type === 'rules') outputs = (last.rules || []).map((rule) => rule.output);
  else if (last?.type === 'value_map') outputs = Object.values(last.values || {});
  else if (!decision.transforms.length && decision.kind === 'column') outputs = [...decision.samples];
  else return null;

  if (last && last.default !== undefined && last.default !== null && last.default !== '') outputs.push(last.default);
  return [...new Set(outputs.filter((output) => output !== null && output !== undefined && output !== '').map(String))];
}

/** Whether the retailer is written by choices the reviewer can change one by one. */
export function canRenameOutputs(decision) {
  if (decision.status === 'constant') return true;
  const last = decision.transforms.at(-1);
  return last?.type === 'rules' || last?.type === 'value_map';
}

const OP_LABELS = {
  equals: 'is',
  startswith: 'starts with',
  endswith: 'ends with',
  contains: 'contains',
  regex: 'matches',
};

/**
 * Each place the decision writes a retailer, one per rule, code or default,
 * with what it matches and the retailer it writes. Changed one at a time by
 * `key`: two rules writing the same retailer stay two rules, so either can be
 * changed back -- editing by retailer name would merge them for good.
 *
 * @returns {{ key: string, when: string, output: string }[]}
 */
export function retailerChoices(decision) {
  if (decision.status === 'constant') {
    return [{ key: 'constant', when: 'Every row', output: String(decision.value ?? '') }];
  }
  const last = decision.transforms.at(-1);
  let choices;
  if (last?.type === 'rules') {
    choices = (last.rules || []).map((rule, index) => ({
      key: `rule:${index}`,
      when: `${OP_LABELS[rule.op] || rule.op} “${rule.value}”`,
      output: String(rule.output ?? ''),
    }));
  } else if (last?.type === 'value_map') {
    choices = Object.entries(last.values || {}).map(([code, output]) => ({
      key: `code:${code}`,
      when: `is “${code}”`,
      output: String(output ?? ''),
    }));
  } else {
    return [];
  }
  if (last.default !== undefined && last.default !== null && last.default !== '') {
    choices.push({ key: 'default', when: 'Anything else', output: String(last.default) });
  }
  return choices;
}

/**
 * The decision's transforms with one choice (retailerChoices `key`) writing
 * `to` instead: that rule's output, that code's value, or the default.
 */
export function withRetailerChoice(transforms, key, to) {
  const list = asList(transforms);
  if (!list.length) return list;
  const last = { ...list.at(-1) };
  if (key === 'default') {
    last.default = to;
  } else if (key.startsWith('rule:')) {
    const index = Number(key.slice('rule:'.length));
    last.rules = (last.rules || []).map((rule, i) => (i === index ? { ...rule, output: to } : rule));
  } else if (key.startsWith('code:')) {
    last.values = { ...(last.values || {}), [key.slice('code:'.length)]: to };
  }
  return [...list.slice(0, -1), last];
}

// ============================================================
// Against the catalog
// ============================================================

/**
 * Where each retailer the mapping writes to stands against the chosen
 * customer, and so what fixes it:
 *   ok        one of the customer's retailers
 *   new       no retailer has this name yet → add it to the customer
 *   unlinked  an upload made it with no customer → link it to the customer
 *   other     another customer's → choose that customer, or change it
 *   invalid   not a retailer name at all (a raw code like "FPON") → change it
 *
 * @returns {{ name: string, status: string, retailerId?: number, owner?: string }[]}
 */
export function retailerStatuses(outputs, customer, customers, unlinked) {
  if (!outputs || !customer) return [];
  const own = new Set(customer.retailers.map((retailer) => retailer.retailer_name));
  const ownerOf = new Map(
    customers.flatMap((item) => item.retailers.map((retailer) => [retailer.retailer_name, item.customer_name])),
  );
  const unlinkedByName = new Map(unlinked.map((retailer) => [retailer.retailer_name, retailer]));

  return outputs.map((name) => {
    if (own.has(name)) return { name, status: 'ok' };
    if (normaliseName(name) !== name) return { name, status: 'invalid' };
    if (unlinkedByName.has(name)) {
      return { name, status: 'unlinked', retailerId: unlinkedByName.get(name).retailer_id };
    }
    if (ownerOf.has(name)) return { name, status: 'other', owner: ownerOf.get(name) };
    return { name, status: 'new' };
  });
}

/**
 * The customer to start the review on: the one the mapping was approved
 * under, else the one whose name the old free-text vendor or the retailers
 * the file writes to point at. Null when nothing points anywhere -- a guess
 * is never better than asking.
 */
export function suggestCustomerId(mapping, customers, outputs) {
  if (mapping.customerId && customers.some((item) => item.customer_id === mapping.customerId)) {
    return mapping.customerId;
  }
  const byName = new Map(customers.map((item) => [item.customer_name, item.customer_id]));
  const candidates = [
    mapping.vendor && normaliseName(mapping.vendor),
    ...(outputs || []).map(retailerFamily),
  ].filter(Boolean);
  const match = candidates.find((name) => byName.has(name));
  return match ? byName.get(match) : null;
}

/**
 * What the new-customer form starts from, read off the retailers the file
 * writes to: `giant_offline` → name `giant`, Offline ticked.
 */
export function newCustomerDefaults(outputs) {
  const names = outputs || [];
  const family = names.map(retailerFamily).find((name) => normaliseName(name) === name) || '';
  const channels = CHANNELS.map((channel) => channel.value).filter((channel) =>
    names.some((name) => name.endsWith(`_${channel}`)),
  );
  return { name: family, channels: channels.length ? channels : ['offline'] };
}
