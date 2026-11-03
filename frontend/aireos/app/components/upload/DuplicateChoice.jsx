'use client';

import { CopyPlus, Replace, SkipForward } from 'lucide-react';

import { cn } from '@/lib/utils';

// What to do with a file that matches an earlier upload, as a file manager
// asks it: replace, keep both, or skip. Sales rows are upserted per retailer,
// store, SKU and period (backend sellout_service.load_clean_rows), so keeping
// both never double-counts; the difference is whether the earlier copy and
// its rows are cleared first. What each does is uploadFlow.duplicateResult.
const OPTIONS = [
  { value: 'replace', label: 'Replace earlier', Icon: Replace },
  { value: 'keep', label: 'Keep both', Icon: CopyPlus },
  { value: 'skip', label: 'Skip', Icon: SkipForward },
];

/**
 * What to do with a duplicate, chosen before Upload. Drawn as one segmented
 * control -- the options share a track, like the dashboard's By week / By
 * month switch -- so it reads as one-or-the-other rather than two buttons.
 * Native radios underneath, so arrow keys, focus and screen-reader
 * announcements behave like any other choice. It starts on Skip for an exact
 * copy and Replace earlier otherwise (uploadFlow.duplicateDecision), and
 * `result` underneath says what the current choice will do.
 *
 * @param {{
 *   id: string,
 *   fileName: string,
 *   value: 'replace' | 'keep' | 'skip',
 *   result: string,
 *   onChange: (value: 'replace' | 'keep' | 'skip') => void,
 * }} props
 */
export default function DuplicateChoice({ id, fileName, value, result, onChange }) {
  return (
    <fieldset className="mt-2">
      <legend className="sr-only">What to do with {fileName}</legend>
      {/* Same track as the dashboard's tabs (ui/tabs TabsList): 3px padding,
          segments rounded one step less than the track so the corners nest. */}
      <div className="inline-flex gap-0.5 rounded-lg bg-lavander p-[3px]">
        {OPTIONS.map(({ value: option, label, Icon }) => (
          // A block (flex) label: inline, it sits on a text line and adds
          // the line's descender space under the segment.
          <label key={option} className="flex cursor-pointer">
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
                // A little less padding on the icon side, which has its own whitespace.
                'inline-flex items-center gap-1.5 rounded-md py-1 pl-2 pr-2.5 text-xs font-medium transition-colors',
                // Inset, so the focus ring never grows the segment past the track.
                'peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-violet',
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
      {result && <p className="mt-1.5 text-xs text-deep-violet-blue/70">{result}</p>}
    </fieldset>
  );
}
