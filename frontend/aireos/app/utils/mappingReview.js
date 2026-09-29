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

    // Only a real melt group collapses. Not every locked rule is one: the
    // built-in mapping's rules are all locked, and several read the same
    // column, so collapsing on locked alone would drop whole columns.
    const meltMatch = matches.find(({ rule }) => Boolean(rule.meltGroup));

    if (meltMatch) {
      if (groupsSeen.has(meltMatch.ruleIndex)) return [];
      groupsSeen.add(meltMatch.ruleIndex);
    }

    const fields = (meltMatch ? [meltMatch] : matches).map(({ rule }) => ({
      targetField: rule.targetField,
      confidence: rule.confidence || 'low',
      rationale: rule.rationale || '',
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

  return rows.sort((a, b) => {
    const byConfidence =
      CONFIDENCE_ORDER[a.confidence ?? 'null'] - CONFIDENCE_ORDER[b.confidence ?? 'null'];
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
export function toRules(mapping, rows) {
  const lockedRules = (mapping?.rules || [])
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.editable === false)
    .map(({ rule, index }) => {
      const edited = rows.find((row) => row.ruleIndex === index && row.meltGroup);
      return edited ? { ...rule, meltGroup: edited.meltGroup } : rule;
    });

  const editableRules = rows
    .filter((row) => !row.locked)
    .flatMap((row) =>
      row.fields.map((field) => ({
        targetField: field.targetField,
        sourceColumn: row.column,
        sourceColumns: [row.column],
        transform: null,
        status: 'mapped',
        editable: true,
        confidence: field.confidence,
        rationale: field.rationale,
      })),
    );

  return [...editableRules, ...lockedRules];
}

/**
 * Which target fields something fills, and what fills them.
 *
 * Read from two places, because they are authoritative about different
 * things. A rule the review cannot edit speaks for itself -- the built-in
 * mapping is entirely such rules, and several of them read the same column, so
 * reading its coverage off the rows would report only the first target each
 * column feeds. Everything editable is read from the rows instead, since those
 * carry the reviewer's changes and the rules do not.
 */
function filledTargets(mapping, rows) {
  const filled = new Map();

  (mapping?.rules || []).forEach((rule) => {
    if (rule.editable !== false || !rule.targetField || filled.has(rule.targetField)) return;
    filled.set(rule.targetField, {
      column: rule.sourceColumn,
      confidence: rule.confidence || 'high',
      locked: true,
    });
  });

  rows.forEach((row) => {
    if (row.locked) return;
    row.fields.forEach((field) => {
      if (filled.has(field.targetField)) return;
      filled.set(field.targetField, {
        column: row.column,
        confidence: field.confidence,
        locked: false,
      });
    });
  });

  return filled;
}

/**
 * Every business field the mapping is expected to fill, and where it stands.
 *
 * Three states, and the difference matters to whoever is reading:
 *   mapped    a source column feeds it
 *   auto      a melt group fills it with no column involved -- period_start
 *             and its two siblings are read out of the period columns' own
 *             headers, so there is nothing to choose and showing them as
 *             missing would send someone hunting for a column that is not
 *             there
 *   unmapped  nothing fills it yet
 *
 * @returns {{ field: string, status: 'mapped'|'auto'|'unmapped', column: string?, confidence: string?, locked: boolean }[]}
 */
export function computeCoverage(mapping, rows) {
  const filled = filledTargets(mapping, rows);
  const periodDerived = new Set(mapping?.periodDerivedFields || []);
  const hasMeltGroup = rows.some((row) => row.locked);

  return (mapping?.coverageFields || []).map((field) => {
    const entry = filled.get(field);
    if (entry) return { field, status: 'mapped', ...entry };

    if (periodDerived.has(field) && hasMeltGroup) {
      return { field, status: 'auto', column: null, confidence: 'high', locked: true };
    }

    return { field, status: 'unmapped', column: null, confidence: null, locked: false };
  });
}

/**
 * What still stands between these rows and an approval.
 *
 * Required fields come from the server's own list of what the ingest step
 * needs, recomputed here against the edited rows rather than read off the
 * mapping, which describes the version that was loaded.
 */
export function reviewIssues(mapping, rows, confirmedColumns, requiredFields) {
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

  const filled = new Set(filledTargets(mapping, rows).keys());

  // A melt group fills the period fields off its own column headers. Counting
  // them as missing because no column is pointed at them would block an
  // approval over a field that is already covered.
  if (rows.some((row) => row.locked)) {
    (mapping?.periodDerivedFields || []).forEach((field) => filled.add(field));
  }

  return {
    unconfirmedLowConfidence: rows.filter(
      (row) => row.confidence === 'low' && !confirmedColumns.has(row.column),
    ),
    duplicateTargets: [...duplicated],
    missingRequired: (requiredFields || []).filter((field) => !filled.has(field)),
    ignoredColumns: rows.filter((row) => !row.fields.length).map((row) => row.column),
  };
}
