// The review screen reads a mapping one field at a time -- "where does the
// sales value come from?" -- while a stored mapping is a list of rules and
// the screen edits it one source column at a time underneath. These functions
// are that change of address, in both directions.
//
// A column can become more than one field. "VEXA ADULT PANTS XL 10S" is the
// product name, the size and the pack size in one string, so a row holds a
// list of fields rather than a single one, and a later transform pulls each
// field out of the value.

// What the review screen calls whatever proposes a mapping. The model behind
// it is a setting (backend MAPPING_MODEL), so no screen names one: it is
// "the AI", and the actual model is shown once, in the header (proposedByLabel).
export const PROPOSER = 'AI';

/**
 * Whether a model proposed this mapping: generate_mapping records its
 * provider. Hand-written reference contracts (scripts/install_reference_contracts)
 * record no provider, so they get no AI disclaimer.
 *
 * @param {{ provider?: string | null } | null | undefined} proposedBy
 */
export function isAiProposal(proposedBy) {
  return Boolean(proposedBy?.provider);
}

/**
 * "Gemini 3.8 Flash" for the model that proposed a mapping (packet proposedBy,
 * from backend generate_mapping), or '' for one written before the model was
 * recorded. Mappings proposed by Claude before the move to Gemini still carry
 * its model id, so "Claude Sonnet 4.6" must keep reading correctly.
 *
 * @param {{ provider?: string | null, model?: string | null } | null | undefined} proposedBy
 */
export function proposedByLabel(proposedBy) {
  const model = proposedBy?.model;
  if (!model) return '';
  const words = String(model)
    .split('-')
    .filter((word) => !/^\d{8}$/.test(word)); // a dated snapshot suffix, e.g. -20250929
  // "claude-sonnet-4-6" -> "Claude Sonnet 4.6": digits that follow each other are one version.
  const parts = [];
  words.forEach((word) => {
    const last = parts.at(-1);
    if (/^\d+$/.test(word) && /^\d+(\.\d+)*$/.test(last || '')) parts[parts.length - 1] = `${last}.${word}`;
    else parts.push(word);
  });
  return parts.map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))).join(' ');
}

export const CONFIDENCE_LABELS = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

// Every field of the sell-out data in words a reviewer uses, with one line on
// what belongs in it (backend mapping_prompt.FIELD_DEFINITIONS, shortened).
// The stored name stays visible beside the label, because the checks and the
// warnings quote it.
export const FIELD_INFO = {
  period_start: { label: 'Period', help: 'The month (or week) the sales are for.' },
  period_end: { label: 'Period end', help: 'Worked out from the period.' },
  period_type: { label: 'Period type', help: 'Whether each row is a month or a week of sales.' },
  retailer: { label: 'Retailer', help: "Which of the customer's retailers (online or offline) the sales belong to." },
  store_code: { label: 'Store code', help: "The retailer's own code for the store or outlet." },
  store_name: { label: 'Store name', help: 'The store as people call it.' },
  store_format: { label: 'Store format', help: 'e.g. Hyper, Super, Online.' },
  sku: { label: 'Product code (SKU)', help: 'Must be one of our master SKUs — see Product codes.' },
  product_name: { label: 'Product name', help: 'The product as the file describes it.' },
  sku_range: { label: 'Product range', help: 'The range, if the file names it.' },
  size: { label: 'Size', help: 'S/M, L, XL…' },
  brand: { label: 'Brand', help: 'The brand, if the file has one.' },
  product_category: { label: 'Category', help: "The retailer's product category." },
  uom: { label: 'Unit of measure', help: 'Always packs (EA).' },
  pack_size: { label: 'Pack size', help: 'Pieces per pack.' },
  quantity_units: { label: 'Units sold', help: 'Packs sold in the period, after returns.' },
  revenue: {
    label: 'Sales value',
    help: 'Gross sales in SGD — never a claim or rebate, and a unit price only as units sold × price.',
  },
  source_file: { label: 'Source file', help: 'The name of the uploaded file.' },
  period_label: { label: 'Period label', help: 'Worked out from the period.' },
};

/** A field's label, falling back to its stored name for a field added later. */
export function fieldLabel(field) {
  return FIELD_INFO[field]?.label || field;
}

/** One field on the row marked as signed off, or not. */
export function withFieldReviewed(row, targetField, reviewed) {
  return {
    ...row,
    fields: row.fields.map((field) => (field.targetField === targetField ? { ...field, reviewed } : field)),
  };
}

// The fields a group of period or outlet columns can fill (backend
// mapping_contract.MEASURE_FIELDS).
export const MEASURE_FIELDS = ['quantity_units', 'revenue'];

// What a group's headings, or the cells above them, may fill besides the
// period: any descriptive field (backend mapping_contract.HEADING_FIELDS).
export const HEADING_FIELDS = [
  'retailer',
  'store_code',
  'store_name',
  'store_format',
  'sku',
  'product_name',
  'sku_range',
  'size',
  'brand',
  'product_category',
  'uom',
];

// The store fields, which are what a group of outlet columns fills unless the
// reviewer says otherwise.
export const STORE_FIELDS = ['store_code', 'store_name'];

/**
 * Which kind of heading a melt group reads: a period, or anything else --
 * outlets, brands, products (called 'store' for the outlet columns that are
 * the common case). Groups are joined on their headings, so all read one kind.
 */
export function groupKind(settings) {
  const target = settings?.key?.target;
  return target && target !== 'period_start' ? 'store' : 'period';
}

/**
 * One row per source column, in file order, with the fields it fills.
 *
 * A column no rule reads still gets a row, with no fields on it: a column
 * silently dropped is the failure mode this screen exists to prevent. The
 * columns of a melt group get rows too; while the group is in use they are
 * its, and the screen does not offer them one by one.
 */
export function toColumnRows(mapping) {
  const samples = mapping?.columnSamples || {};
  const fieldsFor = new Map();
  (mapping?.rules || [])
    .filter((rule) => rule.editable !== false)
    .forEach((rule) => {
      (rule.sourceColumns || []).forEach((column) => {
        if (!fieldsFor.has(column)) fieldsFor.set(column, []);
        fieldsFor.get(column).push({
          targetField: rule.targetField,
          confidence: rule.confidence || 'low',
          rationale: rule.rationale || '',
          reviewed: rule.reviewed === true,
          transform: rule.transform && typeof rule.transform === 'object' ? rule.transform : null,
          // Settings that are not a column or a transform (how a SKU is
          // matched, where its description is read). Carried so an edit keeps them.
          options: rule.options || null,
        });
      });
    });

  return (mapping?.columns || []).map((column) => ({
    column,
    samples: samples[column] || [],
    fields: fieldsFor.get(column) || [],
  }));
}

/**
 * The melt groups the mapping uses: one per measure filled from a group of
 * period or outlet columns, with the settings the contract stores for it,
 * and `entryId`, the column group on screen it is (packet columnGroups).
 */
export function toGroups(mapping) {
  const entries = mapping?.columnGroups || [];
  return (mapping?.rules || [])
    .filter((rule) => rule.meltGroup)
    .map((rule) => {
      const { id, select, key, labels, period_type: periodType } = rule.meltGroup;
      return {
        id,
        field: rule.targetField,
        entryId: entries.find((entry) => entry.meltGroupId === id)?.id || null,
        settings: {
          select,
          key,
          ...(labels?.length ? { labels } : {}),
          ...(periodType ? { period_type: periodType } : {}),
        },
        columns: rule.sourceColumns || [],
        // The field's own contract entry: a measure read from a group can
        // carry transforms (negated sales, say), which must survive an edit.
        fieldEntry: rule.field || { status: 'mapped', melt_group: id },
        confidence: rule.confidence || 'high',
        rationale: rule.rationale || '',
        reviewed: rule.reviewed === true,
      };
    });
}

/** The locked rule a group's headings fill a field through, if the mapping has one. */
function headingRule(mapping, field) {
  return (mapping?.rules || []).find(
    (rule) => rule.targetField === field && rule.editable === false && !rule.meltGroup && rule.field?.melt_group,
  );
}

/** The locked rule reading period_type off the period headings, if any. */
function periodTypeRule(mapping) {
  return (mapping?.rules || []).find(
    (rule) =>
      rule.targetField === 'period_type' &&
      rule.editable === false &&
      rule.field?.status === 'derived' &&
      !rule.field?.from_field,
  );
}

/**
 * The fields the groups' headings fill, and how: the period, or the store
 * code or name, from the headings; a store code or name from the cells above
 * them (a group's labels); and the period type when every group knows it. A
 * field the reviewer filled some other way -- a column, or a decision made
 * without one -- wins, as it does on the server.
 */
export function headingFields(mapping, state) {
  const { rows, groups, fieldReviews = {}, fieldEdits = {} } = state;
  if (!groups.length) return [];
  const elsewhere = new Set([
    ...rows.flatMap((row) => row.fields.map((field) => field.targetField)),
    ...Object.keys(fieldEdits),
  ]);
  const kind = groupKind(groups[0].settings);
  const keyField = groups[0].settings.key?.target;
  const filled = [];

  // `anyGroup`: every group's headings fill the field alike, so the
  // proposal's own group is kept while it is there -- naming another would
  // show as a change on approval. A label is read by its own group only.
  function fill(field, groupId, description, anyGroup = false) {
    const original = headingRule(mapping, field);
    const proposedGroup = original?.field?.melt_group;
    const keep = anyGroup && groups.some((group) => group.id === proposedGroup);
    filled.push({
      field,
      entry: { ...(original?.field || {}), status: 'mapped', melt_group: keep ? proposedGroup : groupId },
      description,
      confidence: original?.confidence || 'high',
      rationale: original?.rationale || '',
      reviewed: original ? original.reviewed === true || fieldReviews[field] === true : true,
    });
  }

  if (keyField && !elsewhere.has(keyField)) {
    fill(
      keyField,
      groups[0].id,
      'Read from the column headings',
      true,
    );
  }
  groups.forEach((group) => {
    (group.settings.labels || []).forEach((label) => {
      if (elsewhere.has(label.target) || filled.some((item) => item.field === label.target)) return;
      const rows = label.rows_above === 1 ? 'the row' : `${label.rows_above} rows`;
      fill(
        label.target,
        group.id,
        label.rows_above === 0
          ? 'Read from the column headings'
          : `Read from ${rows} above the column headings`,
      );
    });
  });

  const knowsPeriodType = kind === 'period' && groups.every((group) => group.settings.period_type);
  const ownPeriodType = (mapping?.rules || []).some(
    (rule) => rule.targetField === 'period_type' && rule.editable === false && rule !== periodTypeRule(mapping),
  );
  if (knowsPeriodType && !elsewhere.has('period_type') && !ownPeriodType) {
    const original = periodTypeRule(mapping);
    filled.push({
      field: 'period_type',
      entry: { ...(original?.field || {}), status: 'derived' },
      description: `Read from the column headings (${groups[0].settings.period_type}s)`,
      confidence: original?.confidence || 'high',
      rationale: original?.rationale || '',
      reviewed: original ? original.reviewed === true || fieldReviews.period_type === true : true,
    });
  }
  return filled;
}

/** Rules the groups and their headings now speak for, so they are not sent twice. */
function supersededRule(mapping, rule) {
  return Boolean(rule.meltGroup) || rule === periodTypeRule(mapping) || Boolean(rule.field?.melt_group && !rule.meltGroup);
}

/**
 * Rebuild the rules array the confirm endpoint expects: one rule per field.
 *
 * A column filling three fields sends three rules naming it, which the server
 * folds back into one multi-target entry. Each melt group goes as a locked
 * rule carrying the group, plus a rule for each field its headings fill. A
 * decision made without a column (a constant retailer, say) that the reviewer
 * changed is sent as edited, and one they set where the proposal had none is
 * added as a rule of its own.
 *
 * @param {object} mapping
 * @param {{ rows: object[], groups: object[], fieldReviews?: object, fieldEdits?: object }} state
 */
export function toRules(mapping, state) {
  const { rows, groups, fieldReviews = {}, fieldEdits = {} } = state;
  const headings = headingFields(mapping, state);
  // A field a group or its headings now fill drops the proposal's other
  // decision for it ("not in this file", say): the server reads the rules in
  // order, and a later one would win.
  const replaced = new Set([...groups.map((group) => group.field), ...headings.map((item) => item.field)]);

  const lockedRules = (mapping?.rules || [])
    .filter((rule) => rule.editable === false && !supersededRule(mapping, rule) && !replaced.has(rule.targetField))
    .map((rule) => {
      const edit = fieldEdits[rule.targetField];
      if (edit) return { ...rule, field: edit, reviewed: true };
      // A field filled without a column (constant, derived, not in this
      // file) is confirmed from its row in the field table.
      return fieldReviews[rule.targetField] ? { ...rule, reviewed: true } : rule;
    });

  const groupRules = groups.map((group) => {
    const annotation = { confidence: group.confidence, rationale: group.rationale, reviewed: group.reviewed };
    return {
      targetField: group.field,
      sourceColumn: group.columns[0] || '',
      sourceColumns: group.columns,
      status: 'derived',
      editable: false,
      ...annotation,
      meltGroup: { ...group.settings, id: group.id, value_target: group.field, ...annotation },
      field: { ...group.fieldEntry, status: 'mapped', melt_group: group.id },
    };
  });

  const headingRules = headings.map((item) => ({
    targetField: item.field,
    sourceColumn: '',
    sourceColumns: [],
    status: item.entry.status,
    editable: false,
    confidence: item.confidence,
    rationale: item.rationale,
    reviewed: item.reviewed,
    field: item.entry,
  }));

  const lockedTargets = new Set([...lockedRules, ...groupRules, ...headingRules].map((rule) => rule.targetField));
  const addedRules = Object.entries(fieldEdits)
    .filter(([field]) => !lockedTargets.has(field))
    .map(([field, entry]) => ({
      targetField: field,
      sourceColumn: '',
      sourceColumns: [],
      status: entry.status,
      editable: false,
      confidence: 'high',
      rationale: 'Chosen by the reviewer.',
      reviewed: true,
      field: entry,
    }));

  const editableRules = rows.flatMap((row) =>
    row.fields.map((field) => ({
      targetField: field.targetField,
      sourceColumn: row.column,
      sourceColumns: [row.column],
      status: 'mapped',
      editable: true,
      confidence: field.confidence,
      rationale: field.rationale,
      reviewed: field.reviewed === true,
      transform: field.transform || null,
      options: field.options || null,
    })),
  );

  return [...editableRules, ...groupRules, ...headingRules, ...lockedRules, ...addedRules];
}

/**
 * How a field filled without a column is filled, in a sentence. Read from its
 * contract entry rather than the backend's one-liner (mapping_view._describe),
 * which names melt groups by id.
 */
function describeDecision(field, entry, fallback) {
  switch (entry?.status) {
    case 'constant':
      return `Always "${entry.value}"`;
    case 'system':
      return "The uploaded file's name";
    case 'not_available':
      return 'Not in this file';
    case 'derived': {
      if (entry.from_layout === 'stated_period') return "The month the file's title states";
      const multiply = (entry.transforms || []).find((transform) => transform.type === 'multiply');
      if (entry.from_field && multiply) return `${fieldLabel(entry.from_field)} × ${multiply.column}`;
      if (entry.from_field) return `Worked out from ${fieldLabel(entry.from_field)}`;
      if (field === 'period_type') return 'Read from the column headings';
      return 'Worked out automatically';
    }
    default:
      return fallback || '';
  }
}

/**
 * Which target fields something fills, and what fills them.
 *
 * Columns are read from the rows and groups from the groups, since those
 * carry the reviewer's changes; then what the groups' headings fill; then the
 * rules the review cannot repoint, unless the reviewer edited the decision.
 * A column the reviewer assigns wins over a locked "not in this file".
 */
function filledTargets(mapping, state) {
  const { rows, groups, fieldReviews = {}, fieldEdits = {} } = state;
  const filled = new Map();

  rows.forEach((row) => {
    row.fields.forEach((field) => {
      if (filled.has(field.targetField)) return;
      filled.set(field.targetField, {
        status: 'mapped',
        column: row.column,
        groupId: null,
        samples: row.samples,
        confidence: field.confidence,
        rationale: field.rationale,
        reviewed: field.reviewed === true,
        transform: field.transform,
        locked: false,
      });
    });
  });

  groups.forEach((group) => {
    if (filled.has(group.field)) return;
    filled.set(group.field, {
      status: 'mapped',
      column: group.columns[0] || null,
      groupId: group.id,
      samples: [],
      confidence: group.confidence,
      rationale: group.rationale,
      reviewed: group.reviewed,
      transform: group.fieldEntry.transforms || null,
      locked: true,
    });
  });

  headingFields(mapping, state).forEach((item) => {
    if (filled.has(item.field)) return;
    filled.set(item.field, {
      status: 'auto',
      column: null,
      groupId: null,
      samples: [],
      description: item.description,
      confidence: item.confidence,
      rationale: item.rationale,
      reviewed: item.reviewed,
      transform: null,
      locked: true,
    });
  });

  (mapping?.rules || [])
    .filter((rule) => rule.editable === false && rule.targetField && !supersededRule(mapping, rule))
    .forEach((rule) => {
      if (filled.has(rule.targetField)) return;
      const edit = fieldEdits[rule.targetField];
      const entry = edit || rule.field || {};
      filled.set(rule.targetField, {
        status: (entry.status || rule.status) === 'not_available' ? 'not_available' : 'auto',
        column: null,
        groupId: null,
        samples: [],
        description: describeDecision(rule.targetField, entry, rule.description || rule.sourceColumn),
        reason: entry.reason || rule.reason || null,
        confidence: edit ? 'high' : rule.confidence || 'high',
        rationale: edit ? 'Chosen by the reviewer.' : rule.rationale || '',
        reviewed: Boolean(edit) || rule.reviewed === true || fieldReviews[rule.targetField] === true,
        transform: entry.transforms || null,
        locked: true,
      });
    });

  Object.entries(fieldEdits).forEach(([field, entry]) => {
    if (filled.has(field)) return;
    filled.set(field, {
      status: entry.status === 'not_available' ? 'not_available' : 'auto',
      column: null,
      groupId: null,
      samples: [],
      description: describeDecision(field, entry, ''),
      reason: entry.reason || null,
      confidence: 'high',
      rationale: 'Chosen by the reviewer.',
      reviewed: true,
      transform: entry.transforms || null,
      locked: true,
    });
  });

  return filled;
}

/**
 * Every field of the sell-out data and how the mapping fills it, in schema
 * order. Four states, and the difference matters to whoever is reading:
 *   mapped         a source column, or a group of them, feeds it
 *   auto           filled without a column: a constant, the column headings,
 *                  worked out from other fields, or written by the pipeline
 *   not_available  the proposal says the file does not hold it, with a reason
 *   unmapped       nothing fills it -- the reviewer cleared it
 *
 * `decidable` is false for the fields the pipeline always fills itself
 * (backend DECIDABLE_FIELDS), which the screen folds away.
 */
export function computeCoverage(mapping, state) {
  const filled = filledTargets(mapping, state);
  const required = new Set(mapping?.requiredFields || []);
  const decidable = new Set(mapping?.targetFields || []);

  return (mapping?.coverageFields || []).map((field) => {
    const base = {
      field,
      label: fieldLabel(field),
      help: FIELD_INFO[field]?.help || '',
      required: required.has(field),
      decidable: decidable.has(field),
    };
    const entry = filled.get(field);
    if (!entry) {
      return { ...base, status: 'unmapped', column: null, groupId: null, samples: [], confidence: null, reviewed: false, locked: false };
    }
    return { ...base, ...entry };
  });
}

/** A decision the proposal was unsure of that nobody has confirmed yet. */
export function needsConfirm(entry) {
  return entry.status !== 'unmapped' && entry.confidence === 'low' && !entry.reviewed;
}

/** A required field nothing fills. */
export function isMissing(entry) {
  return entry.required && (entry.status === 'unmapped' || entry.status === 'not_available');
}

/** The fields a group's headings and the cells above them fill. */
function headingTargets(group) {
  return [group?.settings.key?.target, ...(group?.settings.labels || []).map((label) => label.target)].filter(Boolean);
}

/**
 * A kept group whose headings fill a field being reset gets back what its
 * headings and labels filled in the proposal: the store code or name the
 * reviewer moved between the headings and the row above them.
 */
function withHeadingsReset(group, originalGroups, reset) {
  const proposed = originalGroups.find((item) => item.id === group.id) || originalGroups[0];
  const touched = [...headingTargets(group), ...headingTargets(proposed)].some((field) => reset.has(field));
  if (!proposed || !touched || groupKind(proposed.settings) !== groupKind(group.settings)) return group;
  const settings = without(group.settings, ['labels']);
  return {
    ...group,
    settings: {
      ...settings,
      key: { ...settings.key, target: proposed.settings.key?.target },
      ...(proposed.id === group.id && proposed.settings.labels?.length ? { labels: proposed.settings.labels } : {}),
    },
  };
}

/** A copy of an object without some keys. */
export function without(object, keys) {
  const next = { ...object };
  keys.forEach((key) => delete next[key]);
  return next;
}

/**
 * The edit state with some fields put back as the AI proposed them
 * (`original`: the rows and groups as loaded), everything else left as the
 * reviewer has it.
 *
 * Each field gets back its column (with its transforms -- for the sku, its
 * code table too) or its group, and loses any edit or sign-off made since. A
 * column is read once, so whatever now claims a column the restored fields
 * need gives it up: a group holding it is dropped, and another field reading
 * a column a restored group holds is taken off it.
 *
 * @param {{ rows: object[], groups: object[], fieldReviews?: object, fieldEdits?: object }} state
 * @param {{ rows: object[], groups: object[] }} original
 * @param {string[]} fields
 */
export function withFieldsReset(state, original, fields) {
  const reset = new Set(fields);
  const restoredGroups = original.groups.filter((group) => reset.has(group.field));
  const groupColumns = new Set(restoredGroups.flatMap((group) => group.columns));

  const rows = state.rows.map((row) => {
    const kept = row.fields.filter((field) => !reset.has(field.targetField) && !groupColumns.has(row.column));
    const back = (original.rows.find((item) => item.column === row.column)?.fields || []).filter((field) =>
      reset.has(field.targetField),
    );
    return { ...row, fields: [...kept, ...back] };
  });

  const columnsBack = new Set(
    rows.filter((row) => row.fields.some((field) => reset.has(field.targetField))).map((row) => row.column),
  );
  const groups = [
    ...state.groups
      .filter(
        (group) =>
          !reset.has(group.field) &&
          !group.columns.some((column) => groupColumns.has(column) || columnsBack.has(column)),
      )
      .map((group) => withHeadingsReset(group, original.groups, reset)),
    ...restoredGroups,
  ];

  return {
    rows,
    groups,
    fieldReviews: without(state.fieldReviews || {}, fields),
    fieldEdits: without(state.fieldEdits || {}, fields),
  };
}

/** The rules for some fields, as text, to tell whether they differ. */
export function rulesKeyFor(rules, fields) {
  const wanted = new Set(fields);
  return JSON.stringify(rules.filter((rule) => wanted.has(rule.targetField)));
}

/**
 * What still stands between these edits and an approval, as far as the
 * fields go. The server holds the same rules (backend required_missing_fields,
 * unreviewed_low_confidence), so approval cannot skip them.
 *
 * A column group none of whose columns are used is listed once, as a group,
 * rather than as a dozen unused columns.
 */
export function reviewIssues(mapping, state) {
  const { rows, groups } = state;
  // One column may fill several fields. One field may not be filled by several
  // columns -- both would be renamed to the same name and which survived would
  // be luck -- so that is the clash worth reporting.
  const sourceOf = new Map();
  const duplicated = new Set();
  rows.forEach((row) => {
    row.fields.forEach((field) => {
      if (sourceOf.has(field.targetField) && sourceOf.get(field.targetField) !== row.column) {
        duplicated.add(field.targetField);
      }
      sourceOf.set(field.targetField, row.column);
    });
  });

  const coverage = computeCoverage(mapping, state);
  const inGroups = new Set(groups.flatMap((group) => group.columns));
  const unused = rows.filter((row) => !row.fields.length && !inGroups.has(row.column));
  const unusedNames = new Set(unused.map((row) => row.column));
  const unusedGroups = (mapping?.columnGroups || []).filter(
    (entry) => !entry.problem && entry.columns.every((column) => unusedNames.has(column)),
  );
  const grouped = new Set(unusedGroups.flatMap((entry) => entry.columns));

  return {
    coverage,
    guessed: coverage.filter((entry) => entry.status !== 'unmapped' && entry.confidence === 'low').length,
    unconfirmed: coverage.filter(needsConfirm),
    missingRequired: coverage.filter(isMissing),
    duplicateTargets: [...duplicated],
    unusedColumns: unused.filter((row) => !grouped.has(row.column)),
    unusedGroups,
  };
}

/**
 * Which column groups a measure may be read from now: any without a problem,
 * reading the same kind of heading as the groups other measures use -- they
 * are joined on it, so periods and outlets cannot be mixed in one mapping.
 *
 * @returns {{ entry: object, reason: string }[]} every group, with why it cannot be chosen ('' when it can)
 */
export function groupChoices(mapping, groups, field) {
  const others = groups.filter((group) => group.field !== field);
  const kind = others.length ? groupKind(others[0].settings) : null;
  return (mapping?.columnGroups || []).map((entry) => {
    let reason = '';
    if (entry.problem) reason = entry.problem;
    else if (kind && entry.kind !== kind) {
      reason = kind === 'period' ? 'Other measures are read by period' : 'Other measures are read by outlet';
    }
    return { entry, reason };
  });
}

/** A column group as one choice in a list: what it is and how much it holds. */
export function groupOptionLabel(entry) {
  return `${entry.label} — ${entry.columns.length} ${entry.kind === 'period' ? 'period' : 'outlet'} columns`;
}

/** A period a heading reads as, the way people say it: "Jan 2026", or "5 Jan 2026" for a week. */
export function periodLabel(isoDate, periodType) {
  if (!isoDate) return '';
  const date = new Date(`${isoDate}T00:00:00Z`);
  // A bare date is a calendar date: formatted in UTC so it never shifts a day.
  return date.toLocaleDateString('en-SG', {
    ...(periodType === 'week' ? { day: 'numeric' } : {}),
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function describeTransform(transform) {
  const otherwise = transform.default ? [`else ${transform.default}`] : [];
  switch (transform.type) {
    case 'rules':
      return [
        ...(transform.rules || []).map((rule) => `${rule.op} "${rule.value}" → ${rule.output}`),
        ...otherwise,
      ].join(', ');
    case 'value_map':
      return [
        ...Object.entries(transform.values || {}).map(([from, to]) => `${from} → ${to}`),
        ...otherwise,
      ].join(', ');
    case 'negate':
      return 'negated (sales are recorded as negative)';
    case 'uom_factor':
      return Object.entries(transform.factors || {})
        .map(([uom, factor]) => `× ${typeof factor === 'object' ? factor.column : factor} when ${transform.column} is ${uom}`)
        .join(', ');
    case 'month_start':
      return transform.format ? `read as its month (dates like ${transform.format})` : 'read as its month';
    case 'multiply':
      return `× ${transform.column}`;
    case 'forward_fill':
      return 'a blank cell takes the value above';
    case 'zero_as_empty':
      return '0 means no sale';
    case 'regex_extract':
      return `extract /${transform.pattern}/`;
    default:
      return transform.type;
  }
}

/**
 * A field's transforms in one line, so a reviewer can read what is done to a
 * value without reading the contract: 'equals "FPON" → fairprice_online, else
 * fairprice_offline'.
 */
export function describeTransforms(transforms) {
  if (!Array.isArray(transforms)) return transforms && typeof transforms === 'object' ? describeTransform(transforms) : '';
  return transforms.map(describeTransform).join('; ');
}

// Past this many pairs a code table or rule list is summarised, not listed.
const LISTED_PAIRS = 2;

function summariseTransform(transform) {
  const pairs =
    transform.type === 'value_map'
      ? Object.entries(transform.values || {}).map(([from, to]) => `${from} → ${to}`)
      : transform.type === 'rules'
        ? (transform.rules || []).map((rule) => `${rule.op} "${rule.value}" → ${rule.output}`)
        : null;
  if (!pairs || pairs.length <= LISTED_PAIRS) {
    const text = describeTransform(transform);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const noun = transform.type === 'value_map' ? 'codes' : 'rules';
  const otherwise = transform.default ? `, anything else → ${transform.default}` : '';
  return `Translates ${pairs.length} ${noun} (e.g. ${pairs[0]})${otherwise}`;
}

/**
 * A field's transforms as short sentences, one each, for a tooltip: a long
 * code table reads "Translates 6 codes (e.g. 1909280 → 13271338)" rather than
 * every pair.
 *
 * @returns {string[]}
 */
export function summariseTransforms(transforms) {
  const list = Array.isArray(transforms) ? transforms : transforms && typeof transforms === 'object' ? [transforms] : [];
  return list.map(summariseTransform);
}

// A Python repr'd string, as the backend's warnings quote them: single-quoted
// unless the value holds an apostrophe, then double-quoted.
const QUOTED = `'[^']*'|"[^"]*"`;

// A quoted value, or a list of them, standing on its own -- not the apostrophe
// in "didn't", which has a letter on one side.
const QUOTED_VALUE = new RegExp(
  String.raw`(?<!\w)(\[(?:${QUOTED})(?:, (?:${QUOTED}))*\]|${QUOTED})(?!\w)`,
  'g',
);

/**
 * Split a validation warning into prose and the values it names, so the
 * names can be set in code type like everywhere else on the page.
 *
 * The warnings are sentences built in Python (see backend validate_contract)
 * with column and field names repr'd into them: 'VName', or
 * ['VName', 'Dept Code'] for a list. The quotes and brackets are dropped and a
 * list reads as "VName, Dept Code", matching how the page lists columns
 * elsewhere.
 *
 * @returns {{ text: string, code: boolean }[]}
 */
export function splitWarning(warning) {
  const parts = [];
  let last = 0;

  for (const match of warning.matchAll(QUOTED_VALUE)) {
    if (match.index > last) parts.push({ text: warning.slice(last, match.index), code: false });
    const values = match[0].match(new RegExp(QUOTED, 'g')).map((value) => value.slice(1, -1));
    parts.push({ text: values.join(', '), code: true });
    last = match.index + match[0].length;
  }

  if (last < warning.length) parts.push({ text: warning.slice(last), code: false });
  return parts;
}
