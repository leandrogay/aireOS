'use client';

import { X } from 'lucide-react';

/** Configure one generic transformation stored in the GCS mapping contract. */
export default function FieldTransformationEditor({
  targetField,
  transform,
  onChange,
  disabled = false,
}) {
  const type = transform?.type || 'direct';
  const entries = Object.entries(transform?.values || {});

  const updateValueEntries = (nextEntries) =>
    onChange({
      type: 'value_map',
      values: Object.fromEntries(nextEntries),
      default: transform?.default ?? '',
      case_sensitive: Boolean(transform?.case_sensitive),
    });

  return (
    <div className="mt-3 rounded-md border border-lavander bg-cream/40 p-2">
      <label className="block text-[11px] font-medium text-deep-violet-blue">
        {targetField} transformation
        <select
          value={type}
          disabled={disabled}
          onChange={(event) => {
            const nextType = event.target.value;
            if (nextType === 'direct') {
              onChange(null);
            } else if (nextType === 'regex_extract') {
              onChange({ type: 'regex_extract', pattern: '', group: 1 });
            } else {
              onChange({
                type: 'value_map',
                values: {},
                default: '',
                case_sensitive: false,
              });
            }
          }}
          className="mt-1 w-full rounded-md border border-violet bg-white px-2 py-1.5 text-xs text-deep-violet-blue"
        >
          <option value="direct">Direct value</option>
          <option value="regex_extract">Extract with regex</option>
          <option value="value_map">Map source values</option>
        </select>
      </label>

      {type === 'regex_extract' && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_5rem]">
          <label className="text-[11px] text-deep-violet-blue/70">
            Regex with capture group
            <input
              type="text"
              value={transform?.pattern || ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  type: 'regex_extract',
                  pattern: event.target.value,
                  group: Number(transform?.group || 1),
                })
              }
              placeholder="\b(S/M|XL|L|M|S)\b"
              className="mt-0.5 w-full rounded-md border border-violet bg-white px-2 py-1 font-mono text-[11px]"
            />
          </label>
          <label className="text-[11px] text-deep-violet-blue/70">
            Group
            <input
              type="number"
              min="1"
              value={transform?.group || 1}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  type: 'regex_extract',
                  pattern: transform?.pattern || '',
                  group: Number(event.target.value || 1),
                })
              }
              className="mt-0.5 w-full rounded-md border border-violet bg-white px-2 py-1 text-[11px]"
            />
          </label>
        </div>
      )}

      {type === 'value_map' && (
        <div className="mt-2 space-y-2">
          {(entries.length ? entries : [['', '']]).map(([source, output], index) => (
            <div
              key={index}
              className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1"
            >
              <input
                type="text"
                value={source}
                disabled={disabled}
                aria-label={`Source value ${index + 1}`}
                placeholder="Source value"
                onChange={(event) => {
                  const next = [...(entries.length ? entries : [['', '']])];
                  next[index] = [event.target.value, output];
                  updateValueEntries(next);
                }}
                className="rounded-md border border-violet bg-white px-2 py-1 text-[11px]"
              />
              <span className="text-xs text-deep-violet-blue/60">&rarr;</span>
              <input
                type="text"
                value={output}
                disabled={disabled}
                aria-label={`Target value ${index + 1}`}
                placeholder="Target value"
                onChange={(event) => {
                  const next = [...(entries.length ? entries : [['', '']])];
                  next[index] = [source, event.target.value];
                  updateValueEntries(next);
                }}
                className="rounded-md border border-violet bg-white px-2 py-1 text-[11px]"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  updateValueEntries(entries.filter((_, item) => item !== index))
                }
                aria-label={`Remove value mapping ${index + 1}`}
                className="rounded p-1 text-deep-violet-blue/60 hover:bg-white"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </div>
          ))}

          <button
            type="button"
            disabled={disabled}
            onClick={() => updateValueEntries([...entries, ['', '']])}
            className="text-[11px] font-medium text-deep-violet-blue underline"
          >
            Add another value
          </button>

          <label className="block text-[11px] text-deep-violet-blue/70">
            Default output for all other values
            <input
              type="text"
              value={transform?.default ?? ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...transform,
                  type: 'value_map',
                  values: transform?.values || {},
                  default: event.target.value,
                })
              }
              className="mt-0.5 w-full rounded-md border border-violet bg-white px-2 py-1 text-[11px]"
            />
          </label>

          <label className="flex items-center gap-2 text-[11px] text-deep-violet-blue/70">
            <input
              type="checkbox"
              checked={Boolean(transform?.case_sensitive)}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...transform,
                  type: 'value_map',
                  values: transform?.values || {},
                  case_sensitive: event.target.checked,
                })
              }
            />
            Match case exactly
          </label>
        </div>
      )}
    </div>
  );
}
