'use client';

import { CopyPlus, Replace } from 'lucide-react';

import { cn } from '@/lib/utils';

// The two ways to upload a file that matches an earlier one. Not uploading it
// at all is the row's remove button, so it is not repeated here.
//
// Sales rows are upserted per retailer, store, SKU and period (backend
// sellout_service.load_clean_rows), so keeping both never double-counts; the
// difference is whether the earlier copy and its rows are cleared first.
const OPTIONS = [
  {
    value: 'replace',
    label: 'Replace earlier',
    Icon: Replace,
    result: 'The earlier copy will be removed and this file used instead.',
  },
  {
    value: 'keep',
    label: 'Keep both',
    Icon: CopyPlus,
    result: "Both copies will be kept. Where they overlap, this file's figures are used.",
  },
];

/**
 * What to do with a duplicate, chosen before Upload. Drawn as one segmented
 * control -- the options share a track, like the dashboard's By week / By
 * month switch -- so it reads as one-or-the-other rather than two buttons.
 * Native radios underneath, so arrow keys, focus and screen-reader
 * announcements behave like any other choice. It starts on "Replace earlier"
 * (uploadFlow.duplicateDecision), and the line underneath says what the
 * current choice will do.
 *
 * @param {{
 *   id: string,
 *   fileName: string,
 *   value: 'replace' | 'keep',
 *   onChange: (value: 'replace' | 'keep') => void,
 * }} props
 */
export default function DuplicateChoice({ id, fileName, value, onChange }) {
  const chosen = OPTIONS.find((option) => option.value === value);

  return (
    <fieldset className="mt-2">
      <legend className="sr-only">What to do with {fileName}</legend>
      <div className="inline-flex gap-0.5 rounded-lg bg-lavander p-0.5">
        {OPTIONS.map(({ value: option, label, Icon }) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name={`duplicate-${id}`}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                'peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50',
                value === option
                  ? 'bg-deep-violet-blue text-white shadow-sm'
                  : 'text-deep-violet-blue/70 hover:bg-white/60 hover:text-deep-violet-blue',
              )}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {label}
            </span>
          </label>
        ))}
      </div>
      {chosen && <p className="mt-1.5 text-xs text-deep-violet-blue/70">{chosen.result}</p>}
    </fieldset>
  );
}
