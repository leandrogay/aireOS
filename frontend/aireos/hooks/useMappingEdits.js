'use client';

import { useState } from 'react';

import { retailerDecision, withRetailerChoice } from '@/app/utils/mappingCustomer';
import { groupKind, toColumnRows, toGroups, toRules, withFieldReviewed } from '@/app/utils/mappingReview';
import { withCodeTable } from '@/app/utils/skuCodeTable';

const REVIEWER = { confidence: 'high', rationale: 'Chosen by the reviewer.', reviewed: true };

/** The rules that decide the retailer, as text, to tell whether it was changed. */
function retailerKey(rules) {
  return JSON.stringify(rules.filter((rule) => rule.targetField === 'retailer'));
}

/** A melt group id no other group has, readable in the stored contract. */
function freeGroupId(field, groups) {
  const taken = new Set(groups.map((group) => group.id));
  if (!taken.has(field)) return field;
  let n = 2;
  while (taken.has(`${field}_${n}`)) n += 1;
  return `${field}_${n}`;
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
 *                 -- the retailer, for now -- by field
 * `rules` is all of it folded into what POST /api/mappings/{fp}/preview and
 * /confirm take (mappingReview.toRules), and `changed` says whether it
 * differs from what was loaded.
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
  const [loadedRules] = useState(() => toRules(mapping, { rows: toColumnRows(mapping), groups: toGroups(mapping) }));
  const loadedKey = JSON.stringify(loadedRules);

  const state = { rows, groups, fieldReviews, fieldEdits };
  const rules = toRules(mapping, state);

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
        const without = row.fields.filter((item) => item.targetField !== field);
        return without.length === row.fields.length ? row : { ...row, fields: without };
      }),
    );
  }

  // A measure read from a group of columns, one row per period or outlet: the
  // group detected in the file (packet columnGroups), with its settings. It
  // replaces whatever filled the measure, and takes its columns off anything
  // else -- a column is read once.
  function chooseGroup(field, entry) {
    dropEdit(field);
    forgetConfirm(field);
    const claimed = new Set(entry.columns);
    setRows((prev) =>
      prev.map((row) => {
        const fields = row.fields.filter((item) => item.targetField !== field && !claimed.has(row.column));
        return fields.length === row.fields.length ? row : { ...row, fields };
      }),
    );
    setGroups((prev) => {
      const kept = prev.filter(
        (group) =>
          group.field !== field &&
          !group.columns.some((column) => claimed.has(column)) &&
          // Groups are joined on their headings, so they all read one kind.
          groupKind(group.settings) === entry.kind,
      );
      const id = entry.meltGroupId && !kept.some((group) => group.id === entry.meltGroupId)
        ? entry.meltGroupId
        : freeGroupId(field, kept);
      return [
        ...kept,
        {
          id,
          field,
          entryId: entry.id,
          settings: entry.group,
          columns: entry.columns,
          fieldEntry: { status: 'mapped', melt_group: id },
          ...REVIEWER,
        },
      ];
    });
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

  // Every row goes to one retailer: the retailer becomes a constant, and no
  // column fills it any more (a column would win over the constant).
  function setRetailerConstant(retailerName) {
    forgetConfirm('retailer');
    setRows((prev) =>
      prev.map((row) => ({ ...row, fields: row.fields.filter((field) => field.targetField !== 'retailer') })),
    );
    setFieldEdits((prev) => ({
      ...prev,
      retailer: { status: 'constant', value: retailerName, confidence: 'high', reviewed: true },
    }));
  }

  // One choice the retailer is written by (mappingCustomer.retailerChoices
  // `key`: a rule, a code, the default, or the constant) writing another
  // retailer. Changed one at a time, so any of them can be changed back.
  function setRetailerChoice(key, to) {
    const decision = retailerDecision(mapping, rows, fieldEdits);
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
    changed: JSON.stringify(rules) !== loadedKey,
    retailerChanged: retailerKey(rules) !== retailerKey(loadedRules),
    confirmedNow,
    assignColumn,
    chooseGroup,
    clearField,
    confirmField,
    undoConfirm,
    setSkuCode,
    changeGroupSettings,
    setRetailerConstant,
    setRetailerChoice,
    resetRetailer,
  };
}
