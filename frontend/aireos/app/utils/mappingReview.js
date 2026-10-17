// The review screen reads a mapping one source column at a time -- "what does
// this column in my file become?" -- while a stored mapping is a list of
// target fields, each saying where it comes from. These functions are that
// change of address, in both directions.
//
// A column can become more than one field. "VEXA ADULT PANTS XL 10S" is the
// product name, the size and the pack size in one string, so a row holds a
// list of fields rather than a single one, and a later transform pulls each
// field out of the value.

// Sort order for the review table. `null` -- a column no rule reads -- sorts
// last: it is not an uncertain decision, it is no decision, and it needs the
// reviewer's attention least.
const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2, null: 3 };

export const CONFIDENCE_LABELS = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

/** The least certain of a row's fields — what decides where the row sorts. */
function weakestConfidence(fields) {
  if (!fields.length) return null;
  return fields.reduce(
    (weakest, field) =>
      CONFIDENCE_ORDER[field.confidence] < CONFIDENCE_ORDER[weakest]
        ? field.confidence
        : weakest,
    fields[0].confidence,
  );
}

/**
 * Whether a row still waits on the reviewer: one of its fields was a
 * low-confidence guess nobody has confirmed. The server holds the same rule
 * (see backend unreviewed_low_confidence), so approval cannot skip it.
 */
export function needsReview(row) {
  return row.fields.some((field) => field.confidence === 'low' && !field.reviewed);
}

/**
 * How far through the review the reviewer is: of the columns the proposal was
 * unsure of, how many still wait on them. The only rows approval depends on,
 * so the only ones worth counting.
 */
export function reviewProgress(rows) {
  const guessed = rows.filter((row) => row.fields.some((field) => field.confidence === 'low'));
  return { total: guessed.length, remaining: guessed.filter(needsReview).length };
}

/** Every field on the row marked as signed off, or not. */
export function withReviewed(row, reviewed) {
  return { ...row, fields: row.fields.map((field) => ({ ...field, reviewed })) };
}

/**
 * One row per source column, least certain first.
 *
 * A column no rule reads still gets a row, with no fields on it: a column
 * silently dropped is the failure mode this screen exists to prevent.
 *
 * Melt groups read many columns at once — fifty-two weekly revenue columns are
 * one decision, not fifty-two — so a group contributes a single locked row
 * naming how many columns it covers.
 */
export function toColumnRows(mapping) {
  const rules = mapping?.rules || [];
  const samples = mapping?.columnSamples || {};

  const rulesForColumn = new Map();
  rules.forEach((rule, ruleIndex) => {
    (rule.sourceColumns || []).forEach((column) => {
      if (!rulesForColumn.has(column)) rulesForColumn.set(column, []);
      rulesForColumn.get(column).push({ rule, ruleIndex });
    });
  });

  const groupsSeen = new Set();

  const rows = (mapping?.columns || []).flatMap((column, index) => {
    const matches = rulesForColumn.get(column) || [];

    // Only a real melt group collapses. Other future locked rules may read the
    // same column, so collapsing on locked alone would drop source columns.
    const meltMatch = matches.find(({ rule }) => Boolean(rule.meltGroup));

    if (meltMatch) {
      if (groupsSeen.has(meltMatch.ruleIndex)) return [];
      groupsSeen.add(meltMatch.ruleIndex);
    }

    const fields = (meltMatch ? [meltMatch] : matches).map(({ rule }) => ({
      targetField: rule.targetField,
      confidence: rule.confidence || 'low',
      rationale: rule.rationale || '',
      reviewed: rule.reviewed === true,
      transform: rule.transform && typeof rule.transform === 'object' ? rule.transform : null,
      // Settings that are not a column or a transform (how a SKU is matched,
      // where its description is read). Carried so an edit keeps them.
      options: rule.options || null,
    }));

    return [
      {
        column,
        originalIndex: index,
        samples: samples[column] || [],
        fields,
        confidence: weakestConfidence(fields),
        transform: meltMatch?.rule.transform || null,
        meltGroup: meltMatch?.rule.meltGroup || null,
        ruleIndex: meltMatch ? meltMatch.ruleIndex : null,
        locked: Boolean(meltMatch),
        groupColumns: meltMatch ? meltMatch.rule.sourceColumns : null,
      },
    ];
  });

  // A guess someone already signed off is settled, so it sorts with the sure
  // things rather than above them. Sorted once, on load: re-sorting as rows
  // are confirmed would move the next row out from under the reviewer's cursor.
  const sortKey = (row) =>
    row.fields.length && !needsReview(row) && row.confidence === 'low'
      ? CONFIDENCE_ORDER.high
      : CONFIDENCE_ORDER[row.confidence ?? 'null'];

  return rows.sort((a, b) => {
    const byConfidence = sortKey(a) - sortKey(b);
    return byConfidence !== 0 ? byConfidence : a.originalIndex - b.originalIndex;
  });
}

/**
 * Rebuild the rules array the confirm endpoint expects: one rule per field.
 *
 * A column filling three fields sends three rules naming it, which the server
 * folds back into one multi-target entry. Melt-group rules are carried through
 * from the mapping untouched apart from their edited period settings, since
 * the review never repoints them.
 */
export function toRules(mapping, rows, fieldReviews = {}) {
  const lockedRules = (mapping?.rules || [])
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.editable === false)
    .map(({ rule, index }) => {
      const edited = rows.find((row) => row.ruleIndex === index && row.meltGroup);
      if (!edited) {
        // A field filled without a column (constant, derived, not in this
        // file) is confirmed from the coverage panel, not a row.
        return fieldReviews[rule.targetField] ? { ...rule, reviewed: true } : rule;
      }
      // The melt group is stored verbatim, so the sign-off has to ride on it.
      const reviewed = edited.fields.every((field) => field.reviewed);
      return { ...rule, reviewed, meltGroup: { ...edited.meltGroup, reviewed } };
    });

  const editableRules = rows
    .filter((row) => !row.locked)
    .flatMap((row) =>
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

  return [...editableRules, ...lockedRules];
}

/**
 * Which target fields something fills, and what fills them.
 *
 * Read from two places, because they are authoritative about different
 * things. A rule the review cannot edit speaks for itself -- a melt group, a
 * constant, a derived field, the file's name, or one not in this file.
 * Everything editable is read from the rows instead, since those carry the
 * reviewer's changes and the rules do not. A column the reviewer assigns wins
 * over a locked "not in this file".
 */
function filledTargets(mapping, rows) {
  const filled = new Map();

  rows.forEach((row) => {
    if (row.locked) return;
    row.fields.forEach((field) => {
      if (filled.has(field.targetField)) return;
      filled.set(field.targetField, {
        status: 'mapped',
        column: row.column,
        confidence: field.confidence,
        reviewed: field.reviewed === true,
        locked: false,
      });
    });
  });

  (mapping?.rules || []).forEach((rule) => {
    if (rule.editable !== false || !rule.targetField || filled.has(rule.targetField)) return;
    let status = 'auto';
    if (rule.meltGroup) status = 'mapped';
    else if (rule.status === 'not_available') status = 'not_available';
    filled.set(rule.targetField, {
      status,
      column: rule.meltGroup ? rule.sourceColumn : null,
      description: rule.description || rule.sourceColumn,
      reason: rule.reason || null,
      confidence: rule.confidence || 'high',
      reviewed: rule.reviewed === true,
      locked: true,
    });
  });

  return filled;
}

/**
 * Every field the mapping accounts for, and how.
 *
 * Four states, and the difference matters to whoever is reading:
 *   mapped         a source column (or a group of them) feeds it
 *   auto           filled without a column: a constant, computed from other
 *                  fields, or written by the pipeline
 *   not_available  the proposal says the file does not hold it, with a reason
 *   unmapped       nothing fills it -- the reviewer cleared it
 *
 * @returns {{ field: string, status: 'mapped'|'auto'|'not_available'|'unmapped', column: string?, description: string?, reason: string?, confidence: string?, reviewed: boolean, locked: boolean }[]}
 */
export function computeCoverage(mapping, rows, fieldReviews = {}) {
  const filled = filledTargets(mapping, rows);

  return (mapping?.coverageFields || []).map((field) => {
    const entry = filled.get(field);
    if (!entry) {
      return { field, status: 'unmapped', column: null, confidence: null, reviewed: false, locked: false };
    }
    return { field, ...entry, reviewed: entry.reviewed || fieldReviews[field] === true };
  });
}

/** A decision made without a column that the proposal was unsure of and nobody has confirmed. */
export function needsFieldReview(entry) {
  return entry.locked && !entry.column && entry.confidence === 'low' && !entry.reviewed;
}

/**
 * What still stands between these rows and an approval.
 *
 * Required fields come from the server's own list of what an output row
 * needs, recomputed here against the edited rows rather than read off the
 * mapping, which describes the version that was loaded.
 */
export function reviewIssues(mapping, rows, requiredFields, fieldReviews = {}) {
  // One column may fill several fields. One field may not be filled by several
  // columns -- both would be renamed to the same name and which survived would
  // be luck -- so that is the clash worth reporting.
  const sourceOf = new Map();
  const duplicated = new Set();
  rows.forEach((row) => {
    if (row.locked) return;
    row.fields.forEach((field) => {
      if (sourceOf.has(field.targetField) && sourceOf.get(field.targetField) !== row.column) {
        duplicated.add(field.targetField);
      }
      sourceOf.set(field.targetField, row.column);
    });
  });

  const coverage = computeCoverage(mapping, rows, fieldReviews);
  const statusOf = new Map(coverage.map((entry) => [entry.field, entry.status]));

  return {
    unconfirmedLowConfidence: rows.filter(needsReview),
    unconfirmedFields: coverage.filter(needsFieldReview).map((entry) => entry.field),
    duplicateTargets: [...duplicated],
    missingRequired: (requiredFields || []).filter((field) =>
      ['unmapped', 'not_available', undefined].includes(statusOf.get(field)),
    ),
    ignoredColumns: rows.filter((row) => !row.fields.length).map((row) => row.column),
  };
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
      return 'read as its month';
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
