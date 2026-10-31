import { HEADING_FIELDS, MEASURE_FIELDS, STORE_FIELDS, fieldLabel, groupKind, headingFields, without } from '@/app/utils/mappingReview';

// How one field of the sell-out data is filled, as the field editor offers
// it: one method and its settings. Every way the contract can fill a field
// (backend mapping_contract: mapped from a column or a melt group, a melt
// group's headings or labels, derived, constant, not_available) is one of
// these, in a reviewer's words. Pure: no React.

// ============================================================
// The methods
// ============================================================

export const METHOD_INFO = {
  column: {
    label: 'In a column',
    help: 'Read from one column of the file, one value per row.',
  },
  group: {
    label: 'In a group of period or outlet columns',
    help: 'One row per column of the group: its heading says which period or outlet, its cells hold the figure.',
  },
  headings: {
    label: 'In the column headings',
    help: 'The heading of each period or outlet column the figures are read from.',
  },
  above: {
    label: 'In a row above the column headings',
    help: 'The cell above each outlet heading — where some files write the outlet code over its name.',
  },
  title: {
    label: "In the file's title",
    help: 'The month the title or the lines above the table state, e.g. “DATE : 01 Aug 2026 TO 31 Aug 2026”. Every row gets that month.',
  },
  price: {
    label: 'Units sold × a price column',
    help: "Each row's units sold times its price or cost per unit, from a column of the file.",
  },
  constant: {
    label: 'The same value on every row',
    help: 'Typed once here, written on every row.',
  },
  derived: {
    label: 'Worked out from another field',
    help: "Another field's value, put through the steps below.",
  },
  not_available: {
    label: 'Not in this file',
    help: 'Left empty, with the reason written down for whoever reads the mapping next.',
  },
};

const TITLE_FIELDS = ['period_start'];
const ENTRY_METHODS = ['title', 'price', 'constant', 'derived', 'not_available'];

function asList(transforms) {
  if (Array.isArray(transforms)) return transforms;
  return transforms && typeof transforms === 'object' ? [transforms] : [];
}

/**
 * The methods a field can be filled by, in the order the editor lists them,
 * each with why it cannot be chosen yet ('' when it can). A method is listed
 * even when it is not open yet, so the reviewer learns it exists.
 *
 * @returns {{ method: string, label: string, help: string, reason: string }[]}
 */
export function fieldMethods(field, groups) {
  const kind = groups.length ? groupKind(groups[0].settings) : null;
  const methods = [{ method: 'column', reason: '' }];

  if (MEASURE_FIELDS.includes(field)) methods.push({ method: 'group', reason: '' });
  if (HEADING_FIELDS.includes(field)) {
    const reason = kind === 'store' ? '' : 'Read Units sold from a group of outlet (or product) columns first.';
    methods.push({ method: 'headings', reason }, { method: 'above', reason });
  }
  if (field === 'period_start' || field === 'period_type') {
    methods.push({ method: 'headings', reason: kind === 'period' ? '' : 'Read Units sold from a group of period columns first.' });
  }
  if (TITLE_FIELDS.includes(field)) methods.push({ method: 'title', reason: '' });
  if (field === 'revenue') methods.push({ method: 'price', reason: '' });
  methods.push({ method: 'constant', reason: '' }, { method: 'derived', reason: '' }, { method: 'not_available', reason: '' });

  return methods.map((item) => ({ ...item, ...METHOD_INFO[item.method] }));
}

// Ways that are seldom the answer and take the most explaining. The editor
// keeps them under "More ways" so the usual ones are not crowded out.
const RARE_METHODS = ['derived'];

/**
 * The methods the editor lists first, and the rest for its "More ways": a
 * method that cannot be chosen yet, or a rare one, waits there -- unless it
 * is how the field is filled now, which always shows.
 *
 * @returns {{ main: object[], more: object[] }}
 */
export function methodSections(methods, currentMethod) {
  const main = methods.filter(
    (item) => item.method === currentMethod || (!item.reason && !RARE_METHODS.includes(item.method)),
  );
  return { main, more: methods.filter((item) => !main.includes(item)) };
}

// ============================================================
// How a field is filled now
// ============================================================

/** The proposal's own decision for a field made without a column, if it has one the review still uses. */
function lockedEntry(mapping, field) {
  const rule = (mapping?.rules || []).find(
    (item) =>
      item.targetField === field &&
      item.editable === false &&
      !item.meltGroup &&
      !item.field?.melt_group &&
      // period_type read off the headings is the headings' to give.
      !(field === 'period_type' && item.field?.status === 'derived' && !item.field?.from_field),
  );
  return rule?.field || null;
}

/** A contract entry made without a column, as a decision. */
export function entryDecision(field, entry) {
  const transforms = asList(entry.transforms);
  switch (entry.status) {
    case 'constant':
      return { method: 'constant', value: entry.value ?? '' };
    case 'not_available':
      return { method: 'not_available', reason: entry.reason || '' };
    case 'system':
      return { method: 'system' };
    case 'derived':
      if (entry.from_layout === 'stated_period') return { method: 'title' };
      if (
        field === 'revenue' &&
        entry.from_field === 'quantity_units' &&
        transforms.length === 1 &&
        transforms[0].type === 'multiply'
      ) {
        return { method: 'price', column: transforms[0].column || '' };
      }
      if (entry.from_field) return { method: 'derived', fromField: entry.from_field, transforms };
      return { method: 'headings' };
    default:
      return { method: 'none' };
  }
}

/**
 * How a field is filled in these edits, with the precedence the review sends
 * them in (mappingReview.toRules): a column, a measure's group, a decision the
 * reviewer made without a column, the groups' headings or the cells above
 * them, then the proposal's own decision.
 *
 * @param {object} mapping
 * @param {{ rows: object[], groups: object[], fieldEdits?: object }} state
 * @param {string} field
 */
export function currentDecision(mapping, state, field) {
  const { rows, groups, fieldEdits = {} } = state;

  for (const row of rows) {
    const item = row.fields.find((entry) => entry.targetField === field);
    if (item) return { method: 'column', column: row.column, transforms: asList(item.transform) };
  }

  const group = groups.find((item) => item.field === field);
  if (group) return { method: 'group', entryId: group.entryId, transforms: asList(group.fieldEntry.transforms) };

  if (fieldEdits[field]) return entryDecision(field, fieldEdits[field]);

  if (headingFields(mapping, state).some((item) => item.field === field)) {
    // A label of no rows above reads the headings again: the headings, as for the key.
    const label = groups.flatMap((item) => item.settings.labels || []).find((item) => item.target === field);
    if (label && label.rows_above > 0) return { method: 'above', rowsAbove: label.rows_above };
    return { method: 'headings' };
  }

  const entry = lockedEntry(mapping, field);
  return entry ? entryDecision(field, entry) : { method: 'none' };
}

/**
 * The contract entry a decision made without a column stands for, or null
 * for a decision that lives on a column or a group.
 */
export function decisionEntry(field, decision) {
  if (!ENTRY_METHODS.includes(decision.method) && !(field === 'period_type' && decision.method === 'headings')) {
    return null;
  }
  switch (decision.method) {
    case 'title':
      return { status: 'derived', from_layout: 'stated_period' };
    case 'price':
      return { status: 'derived', from_field: 'quantity_units', transforms: [{ type: 'multiply', column: decision.column }] };
    case 'constant':
      return { status: 'constant', value: String(decision.value ?? '').trim() };
    case 'derived':
      return {
        status: 'derived',
        from_field: decision.fromField,
        ...(decision.transforms?.length ? { transforms: decision.transforms } : {}),
      };
    case 'not_available':
      return { status: 'not_available', reason: String(decision.reason || '').trim() || 'Not in this file.' };
    default:
      // period_type read off the period headings.
      return { status: 'derived' };
  }
}

/**
 * Why a decision is not ready to apply as it stands, or ''. Only what the
 * server would certainly refuse is named; the reviewer may still apply it
 * and see the server's answer when they test.
 */
export function decisionProblem(field, decision, { stated } = {}) {
  switch (decision.method) {
    case 'column':
      return decision.column ? '' : 'Choose a column.';
    case 'group':
      return decision.entryId ? '' : 'Choose a group of columns.';
    case 'price':
      return decision.column ? '' : 'Choose the price column.';
    case 'constant':
      return String(decision.value ?? '').trim() ? '' : 'Type the value.';
    case 'derived':
      if (!decision.fromField) return 'Choose the field it is worked out from.';
      return decision.fromField === field ? 'A field cannot be worked out from itself.' : '';
    case 'title':
      return stated ? '' : "This file's title states no period, so the test will fail on it.";
    default:
      return '';
  }
}

/**
 * The fields worked out from this one (derived with `from_field`), whose
 * rules read its values: moving it to another source changes what they see.
 */
export function dependentFields(mapping, state, field) {
  return (mapping?.targetFields || []).filter((other) => {
    if (other === field) return false;
    const decision = currentDecision(mapping, state, other);
    return (decision.method === 'derived' && decision.fromField === field) || (decision.method === 'price' && field === 'quantity_units');
  });
}

/** A decision in a few words, for the field editor's summary of what changes. */
export function decisionSummary(decision) {
  switch (decision.method) {
    case 'column':
      return `Column “${decision.column}”`;
    case 'group':
      return 'A group of columns';
    case 'headings':
      return 'The column headings';
    case 'above':
      return `${decision.rowsAbove === 1 ? 'The row' : `${decision.rowsAbove} rows`} above the headings`;
    case 'title':
      return "The month the file's title states";
    case 'price':
      return `Units sold × ${decision.column}`;
    case 'constant':
      return `Always “${decision.value}”`;
    case 'derived':
      return `Worked out from ${fieldLabel(decision.fromField)}`;
    case 'not_available':
      return 'Not in this file';
    default:
      return 'Nothing yet';
  }
}

// ============================================================
// Applying a decision to the edits
// ============================================================

// How a decision the reviewer made is annotated: they chose it, so it is
// sure and signed off.
const REVIEWER = { confidence: 'high', rationale: 'Chosen by the reviewer.', reviewed: true };

/** A melt group id no other group has, readable in the stored contract. */
function freeGroupId(field, groups) {
  const taken = new Set(groups.map((group) => group.id));
  if (!taken.has(field)) return field;
  let n = 2;
  while (taken.has(`${field}_${n}`)) n += 1;
  return `${field}_${n}`;
}

function withoutEdit(fieldEdits, field) {
  return without(fieldEdits || {}, [field]);
}

/**
 * The edits with a measure read from a group of columns, one row per period
 * or outlet: a group detected in the file (packet columnGroups), with its
 * settings and the measure's own `transforms` (0 means no sale, say). It
 * replaces whatever filled the measure and takes its columns off anything
 * else -- a column is read once.
 *
 * The groups share one key (backend validate_contract), so an outlet group
 * joins the others reading the same store field from its headings; one
 * replacing the measure's group keeps what that group's headings and the
 * cells above them were filling.
 *
 * @param {{ rows: object[], groups: object[], fieldEdits?: object }} state
 */
export function withGroupChosen(state, field, entry, transforms = []) {
  const claimed = new Set(entry.columns);
  const rows = state.rows.map((row) => {
    const fields = row.fields.filter((item) => item.targetField !== field && !claimed.has(row.column));
    return fields.length === row.fields.length ? row : { ...row, fields };
  });

  const kept = state.groups.filter(
    (group) =>
      group.field !== field &&
      !group.columns.some((column) => claimed.has(column)) &&
      // Groups are joined on their headings, so they all read one kind.
      groupKind(group.settings) === entry.kind,
  );
  const id = entry.meltGroupId && !kept.some((group) => group.id === entry.meltGroupId)
    ? entry.meltGroupId
    : freeGroupId(field, kept);
  const previous = state.groups.find((group) => group.field === field && groupKind(group.settings) === entry.kind);
  const like = kept[0] || previous;
  const settings = like && entry.kind === 'store'
    ? {
        ...entry.group,
        key: { ...entry.group.key, target: like.settings.key.target },
        ...(!kept.length && previous?.settings.labels ? { labels: previous.settings.labels } : {}),
      }
    : entry.group;

  const groups = [
    ...kept,
    {
      id,
      field,
      entryId: entry.id,
      settings,
      columns: entry.columns,
      fieldEntry: { status: 'mapped', melt_group: id, ...(transforms.length ? { transforms } : {}) },
      ...REVIEWER,
    },
  ];
  return { ...state, rows, groups, fieldEdits: withoutEdit(state.fieldEdits, field) };
}

/**
 * One melt group after a store field's source was decided. The headings fill
 * the group's key, and a label of no rows above fills a second store field
 * from them too, so both can read the headings; a label with rows above reads
 * the cells over them. A label is read by the first group only: the groups
 * are joined on their headings, so it reaches every row, and two groups
 * filling one field would clash.
 */
function withStoreSource(group, field, decision, first) {
  let labels = (group.settings.labels || []).filter((label) => label.target !== field);
  let key = group.settings.key;

  if (groupKind(group.settings) === 'store' && HEADING_FIELDS.includes(field)) {
    if (decision.method === 'headings' && key.target !== field && first) labels.push({ rows_above: 0, target: field });
    if (decision.method === 'above') {
      // The headings give the field up: to a field already reading them,
      // else to a store field, which a label cannot also be.
      if (key.target === field) {
        const reading = labels.find((label) => label.rows_above === 0);
        key = { ...key, target: reading?.target || STORE_FIELDS.find((item) => item !== field) || STORE_FIELDS[0] };
      }
      labels = labels.filter((label) => label.target !== key.target);
      if (first) labels.push({ rows_above: decision.rowsAbove, target: field });
    }
  } else if (decision.method === 'headings' && HEADING_FIELDS.includes(field)) {
    key = { ...key, target: field };
  }

  const settings = without(group.settings, ['labels']);
  return { ...group, settings: { ...settings, key, ...(labels.length ? { labels } : {}) } };
}

/**
 * The edits with a field filled the way the field editor decided (the
 * currentDecision shape): the field is taken off whatever filled it, then
 * given its new source -- a column with its steps, a group of columns, the
 * groups' headings or the cells above them, or a decision made without a
 * column. Reading the period from the title also makes the period type a
 * month, since a stated period is read as one (backend validate_contract).
 *
 * @param {object} mapping
 * @param {{ rows: object[], groups: object[], fieldEdits?: object }} state
 * @param {string} field
 * @param {object} decision
 */
export function withFieldDecision(mapping, state, field, decision) {
  if (decision.method === 'group') {
    const current = state.groups.find((group) => group.field === field);
    if (current && current.entryId === decision.entryId) {
      const groups = state.groups.map((group) => {
        if (group.id !== current.id) return group;
        const fieldEntry = without(group.fieldEntry, ['transforms']);
        const transforms = decision.transforms || [];
        return { ...group, ...REVIEWER, fieldEntry: { ...fieldEntry, ...(transforms.length ? { transforms } : {}) } };
      });
      return { ...state, groups, fieldEdits: withoutEdit(state.fieldEdits, field) };
    }
    const columnGroup = (mapping?.columnGroups || []).find((item) => item.id === decision.entryId);
    return columnGroup ? withGroupChosen(state, field, columnGroup, decision.transforms || []) : state;
  }

  // The title's period is a month: the period type follows, unless it
  // already is the constant 'month'.
  const periodType = decision.method === 'title' ? currentDecision(mapping, state, 'period_type') : null;
  const monthly = !periodType || (periodType.method === 'constant' && periodType.value === 'month');

  const rows = state.rows.map((row) => {
    const kept = row.fields.filter(
      (item) => item.targetField !== field && (monthly || item.targetField !== 'period_type'),
    );
    if (decision.method === 'column' && row.column === decision.column) {
      const transform = decision.transforms?.length ? decision.transforms : null;
      return { ...row, fields: [...kept, { targetField: field, ...REVIEWER, transform }] };
    }
    return kept.length === row.fields.length ? row : { ...row, fields: kept };
  });

  const groups = state.groups
    .filter((group) => group.field !== field)
    .map((group, index) => withStoreSource(group, field, decision, index === 0));

  const entry = decisionEntry(field, decision);
  const fieldEdits = withoutEdit(state.fieldEdits, field);
  if (entry) fieldEdits[field] = { ...entry, ...REVIEWER };
  if (!monthly) fieldEdits.period_type = { status: 'constant', value: 'month', ...REVIEWER };

  return { ...state, rows, groups, fieldEdits };
}

// ============================================================
// The cells above the headings
// ============================================================

/**
 * The rows above the header that hold something above at least one of these
 * columns, nearest first, each with the cell over every column (backend
 * layout_detection rows_above_header). An outlet's code written over its
 * name is the row a label reads.
 *
 * @returns {{ rowsAbove: number, row: number, cells: Record<string, string> }[]}
 */
export function rowsAboveChoices(layout, columns) {
  const headerRow = Number(layout?.header_row) || 1;
  return (layout?.rows_above_header || [])
    .map((item) => ({ rowsAbove: headerRow - item.row, row: item.row, cells: item.cells || {} }))
    .filter((item) => item.rowsAbove >= 1 && columns.some((column) => column in item.cells))
    .sort((a, b) => a.rowsAbove - b.rowsAbove);
}
