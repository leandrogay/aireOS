'use client';

import {
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Lock,
  MinusCircle,
  X,
} from 'lucide-react';
import { CONFIDENCE_LABELS, needsReview } from '../../utils/mappingReview';
import FieldTransformationEditor from './FieldTransformationEditor';

const CONFIDENCE_STYLES = {
  high: { Icon: CheckCircle2, className: 'text-green-700' },
  medium: { Icon: HelpCircle, className: 'text-amber-700' },
  low: { Icon: AlertTriangle, className: 'text-red-700' },
};

// A low-confidence guess a reviewer has signed off keeps its label -- it is
// still worth knowing the proposal was unsure -- but stops shouting.
function ConfidenceLabel({ level, reviewed = false, compact = false }) {
  const { Icon, className } = CONFIDENCE_STYLES[level] || CONFIDENCE_STYLES.low;
  const tone = reviewed && level === 'low' ? 'text-deep-violet-blue/60' : className;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone}`}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {compact ? (CONFIDENCE_LABELS[level] || '').replace(' confidence', '') : CONFIDENCE_LABELS[level]}
    </span>
  );
}

/**
 * One source column: what it holds, which fields it becomes, and how sure the
 * proposal was about each of them.
 *
 * A column can become several fields — an article description carries the
 * product name and the size in the same string — so the target is a list you
 * add to, not a single choice that replaces what was there.
 *
 * @param {{
 *   row: object,
 *   targetFields: string[],
 *   takenFields: Map<string, string>,
 *   onAddField: (column: string, field: string) => void,
 *   onRemoveField: (column: string, field: string) => void,
 *   canUndoReview: boolean,
 *   focusConfirm: boolean,
 *   onConfirm: (column: string) => void,
 *   onUndoReview: (column: string) => void,
 *   onMeltGroupChange: (column: string, changes: object) => void,
 *   onTransformChange: (column: string, targetField: string, transform: object|null) => void,
 *   disabled?: boolean,
 *   readOnly?: boolean,
 * }} props
 */
export default function ColumnMappingRow({
  row,
  targetFields,
  takenFields,
  canUndoReview,
  focusConfirm,
  onAddField,
  onRemoveField,
  onConfirm,
  onUndoReview,
  onMeltGroupChange,
  onTransformChange,
  disabled = false,
  readOnly = false,
}) {
  const needsAttention = needsReview(row);
  // A mapping nobody can change reads better as text than as a control that
  // does nothing.
  const fixed = row.locked || readOnly;

  // A field already filled by a different column is not offered: two columns
  // renamed to the same field would collide, and the server drops one of them.
  const available = targetFields.filter((field) => {
    const takenBy = takenFields.get(field);
    return !takenBy || takenBy === row.column;
  });

  return (
    <tr
      className={`border-t border-lavander align-top ${
        needsAttention ? 'bg-red-50/40' : 'bg-white'
      }`}
    >
      <td className="px-3 py-3">
        <p className="font-mono text-xs font-semibold text-deep-violet-blue">{row.column}</p>
        {row.locked && (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-deep-violet-blue/60">
            <Lock aria-hidden="true" className="size-3" />
            and {(row.groupColumns?.length || 1) - 1} more period column
            {row.groupColumns?.length === 2 ? '' : 's'}
          </p>
        )}
      </td>

      <td className="px-3 py-3">
        {row.samples.length ? (
          <ul className="space-y-0.5">
            {row.samples.slice(0, 5).map((value, index) => (
              <li
                key={index}
                className="truncate font-mono text-[11px] text-deep-violet-blue/80"
                title={value}
              >
                {value}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-deep-violet-blue/50">No sample values</span>
        )}
      </td>

      <td className="px-3 py-3">
        {row.fields.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {row.fields.map((field) => (
              <li
                key={field.targetField}
                className="inline-flex items-center gap-1 rounded-md border border-violet bg-lavander/60 py-1 pl-2 pr-1 font-mono text-[11px] text-deep-violet-blue"
              >
                {field.targetField}
                {!fixed && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRemoveField(row.column, field.targetField)}
                    aria-label={`Stop mapping ${row.column} to ${field.targetField}`}
                    title={`Remove ${field.targetField}`}
                    className="rounded p-0.5 text-deep-violet-blue/70 transition hover:bg-white hover:text-deep-violet-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue disabled:opacity-50"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-deep-violet-blue/50">
            {fixed ? 'Not used' : 'No field yet'}
          </p>
        )}

        {!fixed && (
          <select
            value=""
            disabled={disabled || !available.length}
            onChange={(event) => {
              if (event.target.value) onAddField(row.column, event.target.value);
            }}
            aria-label={`Add a target field for ${row.column}`}
            className="mt-2 w-full rounded-md border border-violet bg-white px-2 py-1.5 text-xs text-deep-violet-blue focus:border-deep-violet-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue disabled:opacity-60"
          >
            <option value="">
              {row.fields.length ? '+ Also fills…' : 'Choose a field…'}
            </option>
            {available.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
        )}

        {/* The melt group's period settings are part of the mapping, so they
            remain editable alongside the per-field transformation controls. */}
        {row.meltGroup ? (
          <div className="mt-2 space-y-1.5">
            <label className="block text-[11px] text-deep-violet-blue/70">
              Period pattern
              <input
                type="text"
                value={row.meltGroup.period_extract_regex || ''}
                disabled={disabled}
                onChange={(event) =>
                  onMeltGroupChange(row.column, { period_extract_regex: event.target.value })
                }
                className="mt-0.5 w-full rounded-md border border-violet bg-white px-2 py-1 font-mono text-[11px] text-deep-violet-blue focus:border-deep-violet-blue focus:outline-none"
              />
            </label>
            <label className="block text-[11px] text-deep-violet-blue/70">
              Date format
              <input
                type="text"
                value={row.meltGroup.date_format || ''}
                disabled={disabled}
                onChange={(event) =>
                  onMeltGroupChange(row.column, { date_format: event.target.value })
                }
                className="mt-0.5 w-full rounded-md border border-violet bg-white px-2 py-1 font-mono text-[11px] text-deep-violet-blue focus:border-deep-violet-blue focus:outline-none"
              />
            </label>
          </div>
        ) : row.transform ? (
          <p className="mt-2 text-[11px] text-deep-violet-blue/70">{row.transform}</p>
        ) : null}

        {!row.locked &&
          row.fields.map((field) => (
            <FieldTransformationEditor
              key={field.targetField}
              targetField={field.targetField}
              transform={field.transform}
              onChange={(transform) =>
                onTransformChange(row.column, field.targetField, transform)
              }
              disabled={disabled}
            />
          ))}
      </td>

      <td className="px-3 py-3">
        {row.fields.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-deep-violet-blue/60">
            <MinusCircle aria-hidden="true" className="size-3.5" />
            Not mapped
          </span>
        ) : row.fields.length === 1 ? (
          <>
            <ConfidenceLabel
              level={row.fields[0].confidence}
              reviewed={row.fields[0].reviewed}
            />
            {row.fields[0].rationale && (
              <p className="mt-1 text-[11px] leading-relaxed text-deep-violet-blue/70">
                {row.fields[0].rationale}
              </p>
            )}
          </>
        ) : (
          // One confidence per field, because the same column can be a sure
          // thing for one field and a guess for another.
          <ul className="space-y-1.5">
            {row.fields.map((field) => (
              <li key={field.targetField}>
                <p className="font-mono text-[11px] text-deep-violet-blue">
                  {field.targetField}
                </p>
                <ConfidenceLabel level={field.confidence} reviewed={field.reviewed} compact />
                {field.rationale && (
                  <p className="text-[11px] leading-relaxed text-deep-violet-blue/70">
                    {field.rationale}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </td>

      <td className="px-3 py-3">
        {row.confidence === 'low' ? (
          !needsAttention ? (
            // One line, so a reviewed row is no taller than its neighbours and
            // Undo sits roughly where the pointer already is after Confirm.
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
                Reviewed
              </span>
              {canUndoReview && !disabled && (
                <>
                  <span aria-hidden="true" className="text-xs text-deep-violet-blue/40">
                    ·
                  </span>
                  <button
                    type="button"
                    // Only ever mounted by a Confirm click, so taking focus
                    // here follows the reviewer's action rather than
                    // interrupting a page load.
                    autoFocus
                    onClick={() => onUndoReview(row.column)}
                    aria-label={`Undo review of ${row.column}`}
                    className="inline-flex h-6 items-center rounded-md px-1.5 text-xs font-medium text-deep-violet-blue/70 transition hover:bg-lavander hover:text-deep-violet-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue"
                  >
                    Undo
                  </button>
                </>
              )}
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled}
              // Set only on the row whose review was just undone.
              autoFocus={focusConfirm}
              onClick={() => onConfirm(row.column)}
              className="rounded-md border border-deep-violet-blue bg-white px-2.5 py-1.5 text-xs font-medium text-deep-violet-blue transition hover:bg-lavander focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue disabled:cursor-not-allowed disabled:opacity-60"
            >
              Confirm
            </button>
          )
        ) : (
          <span className="text-xs text-deep-violet-blue/40">—</span>
        )}
      </td>
    </tr>
  );
}
