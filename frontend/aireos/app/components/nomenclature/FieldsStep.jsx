'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { fieldLabel, isMissing, needsConfirm } from '@/app/utils/mappingReview';

import UnusedColumns from '../mappings/UnusedColumns';
import FieldCard from './FieldCard';
import ResetButton from '../mappings/ResetButton';

/** A field worth a look: a low-confidence guess, or a medium one. */
function wantsALook(entry) {
  return needsConfirm(entry) || (entry.status !== 'unmapped' && entry.confidence === 'medium' && !entry.reviewed);
}

/**
 * "Check the fields": every field the reviewer can decide, as a card. The ones
 * the AI was unsure of come first, unticked or badged; the rest follow, ticked,
 * so one skim covers them all. The order is fixed when the screen opens, so a
 * card does not jump away the moment it is ticked. The retailer was settled on
 * the channel screen, and a required field nothing fills has its own screen.
 * Under the cards: the columns nothing reads, each one offered to a field.
 *
 * @param {{
 *   review: ReturnType<import('@/hooks/useGuidedReview').default>,
 *   mapping: object,
 *   onEdit: (entry: object) => void,
 *   onResetStep: (fields: string[]) => void,
 *   disabled: boolean,
 * }} props
 */
export default function FieldsStep({ review, mapping, onEdit, onResetStep, disabled }) {
  const { edits, issues } = review;
  const decidable = issues.coverage.filter((entry) => entry.decidable && entry.field !== 'retailer');
  const stepFields = decidable.map((entry) => entry.field);

  const [order] = useState(() => {
    const shown = decidable.filter((entry) => !isMissing(entry));
    return {
      look: shown.filter(wantsALook).map((entry) => entry.field),
      fine: shown.filter((entry) => !wantsALook(entry)).map((entry) => entry.field),
    };
  });

  const byField = new Map(issues.coverage.map((entry) => [entry.field, entry]));
  const automatic = issues.coverage.filter((entry) => !entry.decidable);
  const openFields = issues.coverage.filter(
    (entry) => entry.decidable && (entry.status === 'unmapped' || entry.status === 'not_available'),
  );

  const renderCards = (fields) => (
    <ul className="grid gap-2 xl:grid-cols-2">
      {fields
        .map((field) => byField.get(field))
        .filter(Boolean)
        .map((entry) => (
          <FieldCard
            key={entry.field}
            entry={entry}
            canUndo={edits.confirmedNow.has(entry.field)}
            canReset={edits.canResetFields([entry.field])}
            onConfirm={edits.confirmField}
            onUndo={edits.undoConfirm}
            onChange={onEdit}
            onReset={() => edits.resetFields([entry.field])}
            disabled={disabled}
          />
        ))}
    </ul>
  );

  return (
    <>
      {issues.duplicateTargets.length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Two columns both fill {issues.duplicateTargets.map(fieldLabel).join(', ')}. Change one so each field has one source.
        </p>
      )}

      {edits.canResetFields(stepFields) && (
        <div className="flex justify-end">
          <ResetButton
            text="Undo my changes on this screen"
            label="Put every field on this screen back as the AI proposed it"
            onClick={() => onResetStep(stepFields)}
            disabled={disabled}
            className="text-sm text-deep-violet-blue"
          />
        </div>
      )}

      {order.look.length > 0 && (
        <section aria-labelledby="fields-look" className="space-y-2">
          <h3 id="fields-look" className="text-sm font-medium text-deep-violet-blue">
            Have a look at these
          </h3>
          {renderCards(order.look)}
        </section>
      )}

      {order.fine.length > 0 && (
        <section aria-labelledby="fields-fine" className="space-y-2">
          <h3 id="fields-fine" className="text-sm font-medium text-deep-violet-blue">
            {order.look.length ? 'These look right to us' : 'Everything looks right to us'}
          </h3>
          {renderCards(order.fine)}
        </section>
      )}

      {automatic.length > 0 && (
        <p className="text-sm text-deep-violet-blue/80">
          Filled automatically: {automatic.map((entry) => entry.label).join(', ')}.
        </p>
      )}

      <UnusedColumns
        rows={issues.unusedColumns}
        unusedGroups={issues.unusedGroups}
        mapping={mapping}
        groups={edits.groups}
        openFields={openFields}
        onAssign={edits.assignColumn}
        onChooseGroup={edits.chooseGroup}
        disabled={disabled}
      />
    </>
  );
}
