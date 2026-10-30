'use client';

import { useState } from 'react';

import { withFieldDecision, withGroupChosen } from '@/app/utils/fieldDecision';
import { retailerDecision, withRetailerChoice } from '@/app/utils/mappingCustomer';
import {
  rulesKeyFor,
  toColumnRows,
  toGroups,
  toRules,
  withFieldReviewed,
  withFieldsReset,
} from '@/app/utils/mappingReview';
import { codeTableOf, withCodeTable } from '@/app/utils/skuCodeTable';

const REVIEWER = { confidence: 'high', rationale: 'Chosen by the reviewer.', reviewed: true };

/** The rules that decide the retailer, as text, to tell whether it was changed. */
function retailerKey(rules) {
  return JSON.stringify(rules.filter((rule) => rule.targetField === 'retailer'));
}

/**
 * The contract-wide settings as the mapping has them (packet `instructions`):
 * whether rows roll up to one per month, and what kind of data the file is
 * (backend mapping_contract.DATA_SOURCES).
 */
function loadedInstructions(mapping) {
  return {
    aggregate: Boolean(mapping?.instructions?.aggregate),
    dataSource: mapping?.instructions?.dataSource || 'aireos_upload',
  };
}

/**
 * The reviewer's edits to one mapping, before they are approved.
 *
 * Four pieces of state, because a mapping is edited in four places:
 *   rows          one per source column, with the fields it fills (and each
 *                 field's own sign-off, saved with the mapping)
 *   groups        the melt groups: a measure read from a group of period or
 *                 outlet columns, one row per period or outlet
 *   fieldReviews  sign-offs on decisions made without a column (a field not
 *                 in this file), by field
 *   fieldEdits    decisions made without a column that the reviewer changed
 *                 (a constant, a field worked out from another, the title's
 *                 period, not in this file), by field
 * `rules` is all of it folded into what POST /api/mappings/{fp}/preview and
 * /confirm take (mappingReview.toRules), and `changed` says whether it, or
 * the contract-wide `instructions` (roll-up, data type), differ from what
 * was loaded.
 *
 * Every action takes a field, not a column: the screen is laid out by field.
 *
 * @param {{ mapping: object }} options
 */
export default function useMappingEdits({ mapping }) {
  const [rows, setRows] = useState(() => toColumnRows(mapping));
  const [groups, setGroups] = useState(() => toGroups(mapping));
  const [fieldReviews, setFieldReviews] = useState({});
  const [fieldEdits, setFieldEdits] = useState({});
  // Fields confirmed by a click on this visit -- the only sign-offs offered an
  // Undo. One loaded already confirmed is a settled decision.
  const [confirmedNow, setConfirmedNow] = useState(() => new Set());
  // The proposal as loaded: what every reset goes back to.
  const [original] = useState(() => ({ rows: toColumnRows(mapping), groups: toGroups(mapping) }));
  const [loadedRules] = useState(() => toRules(mapping, original));
  const loadedKey = JSON.stringify(loadedRules);
  const [instructions, setInstructions] = useState(() => loadedInstructions(mapping));

  const state = { rows, groups, fieldReviews, fieldEdits };
  const rules = toRules(mapping, state);

  // What preview and confirm take besides the rules: only the settings the
  // reviewer changed, so one left alone stays as the server has it.
  const loaded = loadedInstructions(mapping);
  const instructionsPayload = {
    ...(instructions.aggregate !== loaded.aggregate ? { aggregate: instructions.aggregate } : {}),
    ...(instructions.dataSource !== loaded.dataSource ? { data_source: instructions.dataSource } : {}),
  };
  const instructionsChanged = Object.keys(instructionsPayload).length > 0;

  function dropEdit(field) {
    setFieldEdits((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function forgetConfirm(field) {
    setConfirmedNow((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }

  function dropGroupFor(field) {
    setGroups((prev) => prev.filter((group) => group.field !== field));
  }

  // A column can fill several fields, so assigning one adds to what it does.
  // The field is taken off any other column or group, since one field has one
  // source, and picking the column is the reviewer deciding it.
  function assignColumn(field, column) {
    dropEdit(field);
    dropGroupFor(field);
    forgetConfirm(field);
    setRows((prev) =>
      prev.map((row) => {
        if (row.column === column) {
          if (row.fields.some((item) => item.targetField === field)) return row;
          return { ...row, fields: [...row.fields, { targetField: field, ...REVIEWER, transform: null }] };
        }
        const remaining = row.fields.filter((item) => item.targetField !== field);
        return remaining.length === row.fields.length ? row : { ...row, fields: remaining };
      }),
    );
  }

  function applyState(next) {
    setRows(next.rows);
    setGroups(next.groups);
    setFieldEdits(next.fieldEdits);
  }

  // A measure read from a group of columns, one row per period or outlet
  // (fieldDecision.withGroupChosen).
  function chooseGroup(field, entry) {
    forgetConfirm(field);
    applyState(withGroupChosen(state, field, entry));
  }

  // Fill a field the way the field editor decided (fieldDecision.withFieldDecision).
  function setFieldDecision(field, decision) {
    forgetConfirm(field);
    applyState(withFieldDecision(mapping, state, field, decision));
  }

  function setInstruction(name, value) {
    setInstructions((prev) => ({ ...prev, [name]: value }));
  }

  function resetInstructions() {
    setInstructions(loadedInstructions(mapping));
  }

  function clearField(field) {
    dropEdit(field);
    dropGroupFor(field);
    forgetConfirm(field);
    setRows((prev) =>
      prev.map((row) => ({ ...row, fields: row.fields.filter((item) => item.targetField !== field) })),
    );
  }

  // A sign-off lands where the decision lives: on the field of the column
  // that fills it, on the group, or by field for a decision made without a
  // column (which includes what the groups' headings fill).
  function setConfirmed(entry, reviewed) {
    if (entry.groupId) {
      setGroups((prev) => prev.map((group) => (group.id === entry.groupId ? { ...group, reviewed } : group)));
    } else if (entry.column && !entry.locked) {
      setRows((prev) =>
        prev.map((row) => (row.column === entry.column ? withFieldReviewed(row, entry.field, reviewed) : row)),
      );
    } else {
      setFieldReviews((prev) => ({ ...prev, [entry.field]: reviewed }));
    }
  }

  function confirmField(entry) {
    setConfirmed(entry, true);
    setConfirmedNow((prev) => new Set(prev).add(entry.field));
  }

  function undoConfirm(entry) {
    setConfirmed(entry, false);
    forgetConfirm(entry.field);
  }

  // ---- Resetting to the proposal -------------------------------------------------

  /**
   * Whether these fields can go back to the proposal: they were changed, and
   * resetting them would change something (a Period read from headings whose
   * group was removed only comes back with the group).
   */
  function canResetFields(fields) {
    const now = rulesKeyFor(rules, fields);
    if (now === rulesKeyFor(loadedRules, fields)) return false;
    return rulesKeyFor(toRules(mapping, withFieldsReset(state, original, fields)), fields) !== now;
  }

  function resetFields(fields) {
    const next = withFieldsReset(state, original, fields);
    setRows(next.rows);
    setGroups(next.groups);
    setFieldReviews(next.fieldReviews);
    setFieldEdits(next.fieldEdits);
    fields.forEach(forgetConfirm);
  }

  // The product-code table as proposed, and as it is now (the sku field's
  // value_map, skuCodeTable.codeTableOf).
  const proposedCodes = codeTableOf(
    original.rows.flatMap((row) => row.fields).find((field) => field.targetField === 'sku')?.transform,
  );
  const currentCodes = codeTableOf(
    rows.flatMap((row) => row.fields).find((field) => field.targetField === 'sku')?.transform,
  );

  /** Whether a product code's master SKU differs from the proposal. */
  function codeChanged(code) {
    return (currentCodes[code] || '') !== (proposedCodes[code] || '');
  }

  // Back to the proposed master SKU for each of these codes, the rest kept.
  function resetSkuCodes(codes) {
    codes.forEach((code) => setSkuCode(code, proposedCodes[code] || ''));
  }

  // Picking a master SKU for a code is the reviewer deciding the sku field.
  function setSkuCode(code, sku) {
    setRows((prev) =>
      prev.map((row) => {
        if (!row.fields.some((field) => field.targetField === 'sku')) return row;
        return {
          ...row,
          fields: row.fields.map((field) =>
            field.targetField === 'sku'
              ? { ...field, transform: withCodeTable(field.transform, code, sku), reviewed: true }
              : field,
          ),
        };
      }),
    );
  }

  // The group's column pattern or date format, typed by hand. Which columns
  // that picks is only known once the checks run on it.
  function changeGroupSettings(groupId, changes) {
    setGroups((prev) =>
      prev.map((group) =>
        group.id === groupId ? { ...group, settings: { ...group.settings, ...changes }, reviewed: true } : group,
      ),
    );
  }

  // One choice the retailer is written by (mappingCustomer.retailerChoices
  // `key`: a rule, a code, the default, or the constant) writing another
  // retailer. Changed one at a time, so any of them can be changed back.
  function setRetailerChoice(key, to) {
    const decision = retailerDecision(mapping, rows, fieldEdits, groups);
    forgetConfirm('retailer');
    if (decision.kind === 'column') {
      setRows((prev) =>
        prev.map((row) =>
          row.column !== decision.column
            ? row
            : {
                ...row,
                fields: row.fields.map((field) =>
                  field.targetField === 'retailer'
                    ? { ...field, transform: withRetailerChoice(field.transform, key, to), reviewed: true }
                    : field,
                ),
              },
        ),
      );
    } else if (decision.kind === 'locked') {
      const entry = decision.entry;
      setFieldEdits((prev) => ({
        ...prev,
        retailer:
          key === 'constant'
            ? { ...entry, value: to }
            : { ...entry, transforms: withRetailerChoice(entry.transforms, key, to) },
      }));
    }
  }

  // Back to the retailer as the AI proposed it: its column and rules, or its
  // constant, whatever was chosen since.
  function resetRetailer() {
    const original = toColumnRows(mapping);
    dropEdit('retailer');
    forgetConfirm('retailer');
    setRows((prev) =>
      prev.map((row) => {
        const fields = row.fields.filter((field) => field.targetField !== 'retailer');
        const proposed = original
          .find((item) => item.column === row.column)
          ?.fields.find((field) => field.targetField === 'retailer');
        return { ...row, fields: proposed ? [...fields, proposed] : fields };
      }),
    );
  }

  return {
    ...state,
    state,
    rules,
    instructions,
    instructionsPayload,
    instructionsChanged,
    changed: JSON.stringify(rules) !== loadedKey || instructionsChanged,
    retailerChanged: retailerKey(rules) !== retailerKey(loadedRules),
    confirmedNow,
    assignColumn,
    chooseGroup,
    setFieldDecision,
    setInstruction,
    resetInstructions,
    clearField,
    confirmField,
    undoConfirm,
    setSkuCode,
    changeGroupSettings,
    setRetailerChoice,
    resetRetailer,
    canResetFields,
    resetFields,
    codeChanged,
    resetSkuCodes,
  };
}
