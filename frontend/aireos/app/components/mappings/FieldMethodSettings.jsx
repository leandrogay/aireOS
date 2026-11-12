'use client';

import { inputClass, labelClass } from '@/components/ui/formStyles';
import SelectDropdown from '@/components/ui/SelectDropdown';
import { glassNoteClass } from '@/components/ui/surfaceStyles';
import { headingRowChoices } from '@/app/utils/fieldDecision';
import { MEASURE_FIELDS, fieldLabel, groupChoices, groupOptionLabel, periodLabel } from '@/app/utils/mappingReview';
import { cn } from '@/lib/utils';

import CellPicker from './CellPicker';
import StepsEditor from './StepsEditor';

const note = cn(glassNoteClass, 'px-2 py-1.5 text-[11px] text-deep-violet-blue');

/** A few of a column's values, as a picker's option says them. */
function examples(values) {
  return values?.length ? `e.g. ${values.slice(0, 3).join(' · ')}` : '';
}

// Each column offered with a few of its values, so it is chosen by what is
// in it and not only by its heading.
function ColumnPicker({ value, columns, rows, samples, onChange, ariaLabel, placeholder = 'Choose a column…' }) {
  const using = new Map(rows.map((row) => [row.column, row.fields.map((item) => fieldLabel(item.targetField))]));
  return (
    <SelectDropdown
      value={value || ''}
      onChange={onChange}
      size="sm"
      searchable={columns.length > 8}
      searchPlaceholder="Search columns…"
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      options={columns.map((column) => ({
        value: column,
        label: column,
        hint: using.get(column)?.length ? `→ ${using.get(column).join(', ')}` : '',
        description: examples(samples[column]),
      }))}
    />
  );
}

function Samples({ values }) {
  if (!values?.length) return null;
  return (
    <p className="truncate font-mono text-[11px] text-deep-violet-blue/50" title={values.join(' · ')}>
      e.g. {values.slice(0, 4).join(' · ')}
    </p>
  );
}

/** The groups' headings, a few of them, as they read. */
function Headings({ groups }) {
  const columns = groups[0]?.columns || [];
  return (
    <p className={note}>
      {columns.length} headings, e.g. <span className="font-mono">{columns.slice(0, 5).join(', ')}</span>
      {columns.length > 5 && '…'}
    </p>
  );
}

const SIDE_OPTIONS = [
  { value: 'above', label: 'Above the headings' },
  { value: 'below', label: 'Below the headings' },
];

// The cells over and under the group's headings, one choice per row that has
// any, so the reviewer picks the row by what is in it.
function HeadingRow({ draft, onChange, groups, layout }) {
  const columns = groups[0]?.columns || [];
  const choices = headingRowChoices(layout, columns);

  return (
    <div className="space-y-1.5">
      {choices.length > 0 ? (
        <ul className="space-y-1">
          {choices.map((choice) => (
            <li key={choice.row}>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-deep-violet-blue/15 bg-white/40 p-2 hover:bg-white/70">
                <input
                  type="radio"
                  name="heading-row"
                  checked={draft.side === choice.side && draft.rows === choice.rows}
                  onChange={() => onChange({ ...draft, side: choice.side, rows: choice.rows })}
                  className="mt-0.5 size-3.5 accent-deep-violet-blue"
                />
                <span className="min-w-0 text-[11px] text-deep-violet-blue">
                  <span className="font-medium">
                    Row {choice.row} ({choice.rows === 1 ? `just ${choice.side}` : `${choice.rows} rows ${choice.side}`} the
                    headings)
                  </span>
                  <span className="block truncate font-mono text-deep-violet-blue/70">
                    {columns
                      .slice(0, 6)
                      .map((column) => `${column} → ${choice.cells[column] ?? '—'}`)
                      .join(' · ')}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className={note}>
          No cells were found above or below these headings in the file as it was first read. Test the nomenclature to
          read the file again, or say where to look.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2 text-[11px] text-deep-violet-blue/70">
        <div className="w-48">
          <p>Where</p>
          <SelectDropdown
            value={draft.side}
            onChange={(side) => onChange({ ...draft, side })}
            size="sm"
            ariaLabel="Above or below the headings"
            options={SIDE_OPTIONS}
          />
        </div>
        <label className="block">
          Rows from the headings
          <input
            type="number"
            min={1}
            value={draft.rows}
            onChange={(event) => onChange({ ...draft, rows: Math.max(1, Number(event.target.value) || 1) })}
            className={cn(inputClass, 'mt-0.5 block w-24 py-1 text-xs')}
          />
        </label>
      </div>
      {draft.side === 'below' && (
        <p className="text-[11px] text-deep-violet-blue/60">
          The rows from the headings down to this one are headings too, so none of them is read as sales.
        </p>
      )}
    </div>
  );
}

/**
 * What one way of filling a field needs, in the field editor: the column and
 * its steps, the group of columns, which row above or below the headings, the
 * one cell written on every row, the price
 * column, the value, the field it is worked out from, or the reason it is not
 * in the file.
 *
 * @param {{
 *   field: string,
 *   method: string,
 *   draft: object,
 *   onChange: (draft: object) => void,
 *   mapping: object,
 *   rows: object[],
 *   groups: object[],
 *   layout: object,
 * }} props
 */
export default function FieldMethodSettings({ field, method, draft, onChange, mapping, rows, groups, layout }) {
  const columns = mapping.columns || [];
  const samples = mapping.columnSamples || {};
  const steps = (props) => (
    <div>
      <p className={labelClass}>Change the value (optional)</p>
      <StepsEditor
        steps={draft.transforms || []}
        onChange={(transforms) => onChange({ ...draft, transforms })}
        columns={columns}
        field={field}
        {...props}
      />
    </div>
  );

  switch (method) {
    case 'column':
      return (
        <div className="space-y-3">
          <div>
            <ColumnPicker
              value={draft.column}
              columns={columns}
              rows={rows}
              samples={samples}
              onChange={(column) => onChange({ ...draft, column })}
              ariaLabel={`Column for ${fieldLabel(field)}`}
            />
            <Samples values={samples[draft.column]} />
          </div>
          {steps({ samples: samples[draft.column] || [] })}
        </div>
      );

    case 'group': {
      const choices = groupChoices(mapping, groups, field);
      const chosen = choices.find((choice) => choice.entry.id === draft.entryId)?.entry;
      return (
        <div className="space-y-3">
          {choices.length ? (
            <SelectDropdown
              value={draft.entryId || ''}
              onChange={(entryId) => onChange({ ...draft, entryId })}
              size="sm"
              placeholder="Choose a group of columns…"
              ariaLabel={`Group of columns for ${fieldLabel(field)}`}
              options={choices.map(({ entry, reason }) => ({
                value: entry.id,
                label: groupOptionLabel(entry),
                disabled: Boolean(reason),
                hint: reason,
              }))}
            />
          ) : (
            <p className={note}>No repeated period or outlet columns were found in this file.</p>
          )}
          {chosen?.kind === 'period' && chosen.first && (
            <p className={note}>
              One row per {chosen.group?.period_type || 'month'}, {periodLabel(chosen.first)} to {periodLabel(chosen.last)}.
              The heading pattern and date format can be changed under the field once it is applied.
            </p>
          )}
          {chosen?.kind === 'store' && (
            <p className={note}>
              One row per outlet column. Which store field the headings fill, and whether a row above or below them
              holds the other, is set on Store code and Store name.
            </p>
          )}
          {steps({ samples: chosen ? samples[chosen.columns[0]] || [] : [] })}
        </div>
      );
    }

    case 'headings':
      return field === 'period_type' ? (
        <p className={note}>The period type is read from the period headings: months or weeks.</p>
      ) : (
        <div className="space-y-1.5">
          <Headings groups={groups} />
          {field !== 'period_start' && (
            <p className="text-[11px] text-deep-violet-blue/60">
              The same headings can fill more than one field — the store code and the store name, say, or the brand.
              Choose this on each.
            </p>
          )}
        </div>
      );

    case 'headingRow':
      return <HeadingRow draft={draft} onChange={onChange} groups={groups} layout={layout} />;

    case 'title': {
      const stated = layout?.stated_period;
      return stated ? (
        <p className={note}>
          The file says it covers <span className="font-medium">{stated.start}</span> to{' '}
          <span className="font-medium">{stated.end}</span> (“{stated.stated_in}”). Every row is dated{' '}
          {periodLabel(stated.start)}, and the period type becomes Month.
        </p>
      ) : (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          No period was found in this file&apos;s title, the lines above its table or a month heading. You can still choose this — next
          month&apos;s file may state one — but testing on this file will fail.
        </p>
      );
    }

    case 'filename':
      return (
        <p className={note}>
          Every row is dated the month this file is named for, and the period type becomes Month. A file whose name
          states no month, or two, fails when it is loaded rather than being dated by guesswork.
        </p>
      );

    case 'cell':
      return (
        <div className="space-y-3">
          <CellPicker
            value={draft.cell}
            cells={layout?.cells}
            onChange={(cell) => onChange({ ...draft, cell })}
            period={field === 'period_start'}
          />
          {steps({ samples: layout?.cells?.[draft.cell] ? [layout.cells[draft.cell]] : [] })}
        </div>
      );

    case 'price':
      return (
        <div className="space-y-1.5">
          <ColumnPicker
            value={draft.column}
            columns={columns}
            rows={rows}
            samples={samples}
            onChange={(column) => onChange({ ...draft, column })}
            ariaLabel="Price column"
            placeholder="Choose the price or cost column…"
          />
          <Samples values={samples[draft.column]} />
          <p className="text-[11px] text-deep-violet-blue/60">
            Sales value = {fieldLabel('quantity_units')} × this column, row by row. Change it any time, e.g. from a promo
            cost to a normal cost.
          </p>
        </div>
      );

    case 'constant':
      return field === 'period_type' ? (
        <SelectDropdown
          value={draft.value || ''}
          onChange={(value) => onChange({ ...draft, value })}
          size="sm"
          ariaLabel="Period type"
          options={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
          ]}
        />
      ) : (
        <input
          type="text"
          value={draft.value ?? ''}
          aria-label={`Value for ${fieldLabel(field)}`}
          placeholder="Type the value"
          onChange={(event) => onChange({ ...draft, value: event.target.value })}
          className={cn(inputClass, 'py-1 text-xs')}
        />
      );

    case 'derived': {
      // The column a field is read from, whose values are what this one is worked out from.
      const sourceOf = (other) => rows.find((row) => row.fields.some((item) => item.targetField === other));
      const from = draft.fromField ? sourceOf(draft.fromField) : null;
      return (
        <div className="space-y-3">
          <SelectDropdown
            value={draft.fromField || ''}
            onChange={(fromField) => onChange({ ...draft, fromField })}
            size="sm"
            placeholder="Choose a field…"
            ariaLabel={`Field ${fieldLabel(field)} is worked out from`}
            options={(mapping.targetFields || [])
              .filter((item) => item !== field)
              .map((item) => ({
                value: item,
                label: fieldLabel(item),
                hint: MEASURE_FIELDS.includes(item) ? 'a figure' : '',
                description: examples(samples[sourceOf(item)?.column]),
              }))}
          />
          {steps({ samples: from ? samples[from.column] || [] : [] })}
        </div>
      );
    }

    case 'not_available':
      return (
        <label className="block text-[11px] text-deep-violet-blue/70">
          Why it is not in the file (kept with the nomenclature)
          <input
            type="text"
            value={draft.reason || ''}
            placeholder="e.g. The report lists outlets by code only."
            onChange={(event) => onChange({ ...draft, reason: event.target.value })}
            className={cn(inputClass, 'mt-0.5 py-1 text-xs')}
          />
        </label>
      );

    default:
      return null;
  }
}
