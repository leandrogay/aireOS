'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

const defaultInputClass =
  'w-full min-w-0 max-w-full rounded-md border border-lavander bg-cream px-2.5 py-1 pr-8 text-sm tabular-nums text-deep-violet-blue focus:border-violet focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const defaultLabelClass = 'mb-0.5 block text-xs font-medium text-deep-violet-blue';
const defaultErrorClass = 'mt-0.5 text-xs text-red-700';
const ISO_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
const MASK = 'dd/mm/yyyy';
const SLOT_AT = [0, 1, -1, 2, 3, -1, 4, 5, 6, 7];
const DISPLAY_AT = [0, 1, 3, 4, 6, 7, 8, 9];
const SEGMENTS = [
  { slots: [0, 1], start: 0, end: 2 },
  { slots: [2, 3], start: 3, end: 5 },
  { slots: [4, 5, 6, 7], start: 6, end: 10 },
];

/**
 * Later of the given YYYY-MM-DD strings. Empty values are ignored.
 *
 * @param {...(string | undefined)} values
 * @returns {string | undefined}
 */
export function maxYmd(...values) {
  const present = values.filter(Boolean);
  return present.length ? present.sort()[present.length - 1] : undefined;
}

/**
 * Earlier of the given YYYY-MM-DD strings. Empty values are ignored.
 *
 * @param {...(string | undefined)} values
 * @returns {string | undefined}
 */
export function minYmd(...values) {
  const present = values.filter(Boolean);
  return present.length ? present.sort()[0] : undefined;
}

/**
 * Keep a YYYY-MM-DD value inside [min, max]. Empty stays empty.
 *
 * @param {string} value
 * @param {string | undefined} min
 * @param {string | undefined} max
 * @returns {string}
 */
export function clampDateRangeValue(value, min, max) {
  if (!value) return value;
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

/**
 * Days in a calendar month. Unknown year treats February as 29 so
 * leap-day can still be typed before the year is finished.
 *
 * @param {number} month 1-12
 * @param {number} [year]
 * @returns {number}
 */
function daysInMonth(month, year) {
  if (month === 2 && !year) return 29;
  return new Date(year || 2024, month, 0).getDate();
}

/**
 * @param {string | number} year
 * @param {string | number} month
 * @param {string | number} day
 * @returns {boolean}
 */
function isValidYmd(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

/**
 * True when `iso` can be chosen in a calendar with this min/max.
 *
 * @param {string} iso
 * @param {string | undefined} min
 * @param {string | undefined} max
 * @returns {boolean}
 */
function isIsoInCalendarRange(iso, min, max) {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

/**
 * @returns {string[]}
 */
function emptySlots() {
  return ['', '', '', '', '', '', '', ''];
}

/**
 * @param {string[]} slots
 * @returns {string}
 */
function slotsToDisplay(slots) {
  return MASK.split('').map((ch, index) => {
    if (ch === '/') return '/';
    return slots[SLOT_AT[index]] || ch;
  }).join('');
}

/**
 * @param {string} iso
 * @returns {string[]}
 */
function isoToSlots(iso) {
  const dmy = isoToDmy(iso);
  const digits = dmy.replace(/\D/g, '');
  if (digits.length !== 8) return emptySlots();
  return digits.split('');
}

/**
 * @param {string[]} slots
 * @returns {string | null}
 */
function slotsToIso(slots) {
  if (slots.some((slot) => !slot)) return null;
  const day = `${slots[0]}${slots[1]}`;
  const month = `${slots[2]}${slots[3]}`;
  const year = `${slots[4]}${slots[5]}${slots[6]}${slots[7]}`;
  return isValidYmd(year, month, day) ? `${year}-${month}-${day}` : null;
}

/**
 * @param {string[]} slots
 * @param {string | undefined} min
 * @param {string | undefined} max
 * @returns {boolean}
 */
function isSlotsAllowed(slots, min, max) {
  const day = `${slots[0]}${slots[1]}`;
  const month = `${slots[2]}${slots[3]}`;
  const year = `${slots[4]}${slots[5]}${slots[6]}${slots[7]}`;

  if (slots[0] === '0' && slots[1] === '0') return false;
  if (slots[2] === '0' && slots[3] === '0') return false;

  if (slots[0] && !slots[1] && Number(slots[0]) > 3) return false;
  if (slots[0] && slots[1]) {
    const value = Number(day);
    if (value < 1 || value > 31) return false;
  }

  if (slots[2] && !slots[3] && Number(slots[2]) > 1) return false;
  if (slots[2] && slots[3]) {
    const value = Number(month);
    if (value < 1 || value > 12) return false;
  }

  if (day.length === 2 && month.length === 2) {
    const yearNumber = year.length === 4 ? Number(year) : undefined;
    if (Number(day) > daysInMonth(Number(month), yearNumber)) return false;
  }

  if (day.length === 2 && month.length === 2 && year.length === 4) {
    if (!isValidYmd(year, month, day)) return false;
    return isIsoInCalendarRange(`${year}-${month}-${day}`, min, max);
  }

  return true;
}

/**
 * @param {number} pos
 * @returns {number}
 */
function segmentFromPos(pos) {
  if (pos <= 2) return 0;
  if (pos <= 5) return 1;
  return 2;
}

/**
 * YYYY-MM-DD → dd/mm/yyyy for the typeable field.
 *
 * @param {string} iso
 * @returns {string}
 */
export function isoToDmy(iso) {
  const match = ISO_YMD.exec(String(iso || '').slice(0, 10));
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Accept dd/mm/yyyy, dd-mm-yyyy, or YYYY-MM-DD.
 * Returns ISO, '' if empty, or null if the text is not a complete date yet.
 *
 * @param {string} raw
 * @returns {string | null}
 */
export function parseTypedDate(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  const iso = ISO_YMD.exec(text);
  if (iso) {
    return isValidYmd(iso[1], iso[2], iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }

  const dmy = DMY.exec(text);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3];
    return isValidYmd(year, month, day) ? `${year}-${month}-${day}` : null;
  }

  return null;
}

/**
 * One date: type digits into dd/mm/yyyy, or pick from the calendar icon.
 * Slashes stay put; only the number segments can change.
 *
 * @param {{
 *   id: string,
 *   name: string,
 *   label: string,
 *   required?: boolean,
 *   value: string,
 *   min?: string,
 *   max?: string,
 *   disabled?: boolean,
 *   error?: string,
 *   inputClassName?: string,
 *   labelClassName?: string,
 *   calendarLabel: string,
 *   onChange: (value: string) => void,
 * }} props
 */
function DateField({
  id,
  name,
  label,
  required = false,
  value,
  min,
  max,
  disabled = false,
  error,
  inputClassName,
  labelClassName,
  calendarLabel,
  onChange,
}) {
  const inputRef = useRef(null);
  const focusedRef = useRef(false);
  const segmentRef = useRef(0);
  const selectionRef = useRef({ start: 0, end: 2 });
  const keyHandledRef = useRef(false);
  const slotsRef = useRef(isoToSlots(value));
  const [slots, setSlots] = useState(() => isoToSlots(value));
  const [selTick, setSelTick] = useState(0);

  slotsRef.current = slots;

  useEffect(() => {
    if (focusedRef.current) return;
    const next = isoToSlots(value);
    slotsRef.current = next;
    setSlots(next);
  }, [value]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const selection = selectionRef.current;
    if (!input || !selection || !focusedRef.current) return;
    input.setSelectionRange(selection.start, selection.end);
  }, [slots, selTick]);

  /**
   * @param {{ start: number, end: number }} selection
   */
  const requestSelection = (selection) => {
    selectionRef.current = selection;
    const input = inputRef.current;
    if (input && focusedRef.current) {
      input.setSelectionRange(selection.start, selection.end);
    }
    setSelTick((tick) => tick + 1);
  };

  /**
   * @param {number} index
   */
  const goToSegment = (index) => {
    const segment = SEGMENTS[index];
    segmentRef.current = index;
    requestSelection({ start: segment.start, end: segment.end });
  };

  const selectFromPointer = () => {
    const input = inputRef.current;
    if (!input) return;
    if (!slotsRef.current.some(Boolean)) {
      goToSegment(0);
      return;
    }
    goToSegment(segmentFromPos(input.selectionStart ?? 0));
  };

  /**
   * @param {string[]} next
   */
  const applySlots = (next) => {
    slotsRef.current = next;
    setSlots(next);
    const iso = slotsToIso(next);
    if (iso) onChange(iso);
    else if (next.every((slot) => !slot)) onChange('');
  };

  /**
   * @param {string} iso
   */
  const commit = (iso) => {
    if (iso && !isIsoInCalendarRange(iso, min, max)) return;
    onChange(iso);
    const next = isoToSlots(iso);
    slotsRef.current = next;
    setSlots(next);
  };

  /**
   * @returns {boolean}
   */
  const isWholeFieldSelected = () => {
    const input = inputRef.current;
    return Boolean(input && input.selectionStart === 0 && input.selectionEnd === MASK.length);
  };

  /**
   * @param {{ slots: number[], start: number, end: number }} segment
   * @returns {boolean}
   */
  const isSegmentSelected = (segment) => {
    const input = inputRef.current;
    if (!input) return false;
    return input.selectionStart === segment.start && input.selectionEnd === segment.end;
  };

  /**
   * @param {string} digit
   * @param {number} [forcedSegment]
   * @param {boolean} [replaceSegment]
   */
  const insertDigit = (digit, forcedSegment, replaceSegment = false) => {
    const next = isWholeFieldSelected() && forcedSegment == null
      ? emptySlots()
      : [...slotsRef.current];
    if (isWholeFieldSelected() && forcedSegment == null) {
      segmentRef.current = 0;
    }

    const segmentIndex = forcedSegment ?? segmentRef.current;
    const segment = SEGMENTS[segmentIndex];
    const replace = replaceSegment || isSegmentSelected(segment) || isWholeFieldSelected();
    const filled = segment.slots.filter((slot) => next[slot]).length;
    const writeIndex = replace ? 0 : filled;

    if (writeIndex >= segment.slots.length) {
      if (segmentIndex < 2) insertDigit(digit, segmentIndex + 1, true);
      return;
    }

    if (replace) {
      for (const slot of segment.slots) next[slot] = '';
    }

    if (
      writeIndex === 0 &&
      segment.slots.length === 2 &&
      ((segmentIndex === 0 && Number(digit) > 3) || (segmentIndex === 1 && Number(digit) > 1))
    ) {
      next[segment.slots[0]] = '0';
      next[segment.slots[1]] = digit;
      if (!isSlotsAllowed(next, min, max)) return;
      applySlots(next);
      if (segmentIndex < 2) goToSegment(segmentIndex + 1);
      return;
    }

    next[segment.slots[writeIndex]] = digit;
    if (!isSlotsAllowed(next, min, max)) return;
    applySlots(next);

    const nowFilled = segment.slots.filter((slot) => next[slot]).length;
    if (nowFilled === segment.slots.length) {
      if (segmentIndex < 2) goToSegment(segmentIndex + 1);
      else requestSelection({ start: MASK.length, end: MASK.length });
      return;
    }

    const caret = DISPLAY_AT[segment.slots[nowFilled - 1]] + 1;
    requestSelection({ start: caret, end: caret });
  };

  const deleteBackward = () => {
    const current = [...slotsRef.current];
    if (isWholeFieldSelected()) {
      applySlots(emptySlots());
      goToSegment(0);
      return;
    }

    const segmentIndex = segmentRef.current;
    const segment = SEGMENTS[segmentIndex];
    const next = [...current];
    const filled = segment.slots.filter((slot) => next[slot]).length;

    if (isSegmentSelected(segment) || filled === 0) {
      if (filled > 0) {
        for (const slot of segment.slots) next[slot] = '';
        applySlots(next);
        requestSelection({ start: segment.start, end: segment.end });
        return;
      }
      if (segmentIndex === 0) {
        requestSelection({ start: segment.start, end: segment.end });
        return;
      }
      const previous = SEGMENTS[segmentIndex - 1];
      const lastFilled = [...previous.slots].reverse().find((slot) => next[slot]);
      if (lastFilled != null) next[lastFilled] = '';
      applySlots(next);
      goToSegment(segmentIndex - 1);
      return;
    }

    const lastFilled = [...segment.slots].reverse().find((slot) => next[slot]);
    if (lastFilled == null) return;
    next[lastFilled] = '';
    applySlots(next);
    const remaining = segment.slots.filter((slot) => next[slot]).length;
    if (remaining === 0) {
      requestSelection({ start: segment.start, end: segment.end });
      return;
    }
    const caret = DISPLAY_AT[segment.slots[remaining - 1]] + 1;
    requestSelection({ start: caret, end: caret });
  };

  const handlePaste = (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') || '';
    const parsed = parseTypedDate(text);
    if (parsed === null || parsed === '') {
      const digits = text.replace(/\D/g, '');
      if (digits.length !== 8) return;
      const next = digits.split('');
      if (!isSlotsAllowed(next, min, max)) return;
      const iso = slotsToIso(next);
      if (!iso) return;
      applySlots(next);
      requestSelection({ start: MASK.length, end: MASK.length });
      return;
    }
    if (!isIsoInCalendarRange(parsed, min, max)) return;
    applySlots(isoToSlots(parsed));
    requestSelection({ start: MASK.length, end: MASK.length });
  };

  /**
   * @param {import('react').KeyboardEvent<HTMLInputElement>} event
   */
  const handleKeyDown = (event) => {
    if (disabled) return;
    const key = event.key;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (key === 'Tab') return;
    if (key === 'ArrowLeft') {
      event.preventDefault();
      goToSegment(Math.max(0, segmentRef.current - 1));
      return;
    }
    if (key === 'ArrowRight') {
      event.preventDefault();
      goToSegment(Math.min(2, segmentRef.current + 1));
      return;
    }
    if (key === 'Home') {
      event.preventDefault();
      goToSegment(0);
      return;
    }
    if (key === 'End') {
      event.preventDefault();
      goToSegment(2);
      return;
    }
    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault();
      keyHandledRef.current = true;
      deleteBackward();
      requestAnimationFrame(() => {
        keyHandledRef.current = false;
      });
      return;
    }
    if (key === '/' || key === '-') {
      event.preventDefault();
      goToSegment(Math.min(2, segmentRef.current + 1));
      return;
    }
    if (/^\d$/.test(key)) {
      event.preventDefault();
      keyHandledRef.current = true;
      insertDigit(key);
      requestAnimationFrame(() => {
        keyHandledRef.current = false;
      });
      return;
    }
    if (key.length === 1) event.preventDefault();
  };

  const display = slotsToDisplay(slots);
  const hasDigits = slots.some(Boolean);

  return (
    <div>
      <label htmlFor={id} className={cn(defaultLabelClass, labelClassName)}>
        {label}
        {required ? <span className="text-red-700"> *</span> : null}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={10}
          value={display}
          disabled={disabled}
          onFocus={() => {
            focusedRef.current = true;
            requestAnimationFrame(selectFromPointer);
          }}
          onMouseUp={() => {
            requestAnimationFrame(selectFromPointer);
          }}
          onClick={() => {
            requestAnimationFrame(selectFromPointer);
          }}
          onKeyDown={handleKeyDown}
          onBeforeInput={(event) => {
            event.preventDefault();
            if (keyHandledRef.current) {
              keyHandledRef.current = false;
              return;
            }
            if (event.inputType === 'insertText' && /^\d$/.test(event.data || '')) {
              insertDigit(event.data);
              return;
            }
            if (String(event.inputType).startsWith('delete')) deleteBackward();
          }}
          onPaste={handlePaste}
          onCut={(event) => {
            event.preventDefault();
            deleteBackward();
          }}
          onChange={() => {
            const input = inputRef.current;
            const selection = selectionRef.current;
            if (!input) return;
            input.value = slotsToDisplay(slotsRef.current);
            if (selection) input.setSelectionRange(selection.start, selection.end);
          }}
          onBlur={() => {
            focusedRef.current = false;
            const current = slotsRef.current;
            const iso = slotsToIso(current);
            if (iso) {
              commit(iso);
              return;
            }
            if (current.every((slot) => !slot)) {
              onChange('');
              return;
            }
            const reverted = isoToSlots(value);
            slotsRef.current = reverted;
            setSlots(reverted);
          }}
          className={cn(
            defaultInputClass,
            !hasDigits && 'text-deep-violet-blue/45',
            inputClassName,
          )}
        />
        <input
          type="date"
          tabIndex={-1}
          aria-label={calendarLabel}
          value={value}
          min={min || undefined}
          max={max || undefined}
          disabled={disabled}
          onChange={(event) => commit(event.target.value)}
          className="absolute inset-y-0 right-0 w-8 cursor-pointer border-0 bg-transparent p-0 opacity-0 disabled:cursor-not-allowed"
        />
        <span
          className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-center text-deep-violet-blue/45"
          aria-hidden="true"
        >
          <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current">
            <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" strokeWidth="1.25" />
            <path d="M2 6.5h12M5.5 2v3M10.5 2v3" strokeWidth="1.25" />
          </svg>
        </span>
      </div>
      {error ? <p className={defaultErrorClass}>{error}</p> : null}
    </div>
  );
}

/**
 * Pair of start/end dates. Type digits into dd/mm/yyyy or pick from
 * the calendar icon. Slashes are fixed; only the numbers change.
 *
 * Either date can be filled first. After start is set, end cannot be
 * earlier. After end is set, start cannot be later. Optional minDate /
 * maxDate cap the whole range (useful on dashboard).
 *
 * Standalone (dashboard):
 *   import DateRangePicker from '@/components/ui/DateRangePicker'
 *
 *   <DateRangePicker
 *     start={start}
 *     end={end}
 *     onStartChange={setStart}
 *     onEndChange={setEnd}
 *   />
 *
 * Inside an existing CSS grid (promotions form), pass className="contents"
 * so the two fields stay separate grid cells.
 *
 * @param {{
 *   start?: string,
 *   end?: string,
 *   onStartChange: (value: string) => void,
 *   onEndChange: (value: string) => void,
 *   startLabel?: string,
 *   endLabel?: string,
 *   required?: boolean,
 *   startRequired?: boolean,
 *   endRequired?: boolean,
 *   disabled?: boolean,
 *   minDate?: string,
 *   maxDate?: string,
 *   startError?: string,
 *   endError?: string,
 *   startName?: string,
 *   endName?: string,
 *   className?: string,
 *   inputClassName?: string,
 *   labelClassName?: string,
 * }} props
 */
export default function DateRangePicker({
  start = '',
  end = '',
  onStartChange,
  onEndChange,
  startLabel = 'Start date',
  endLabel = 'End date',
  required = false,
  startRequired,
  endRequired,
  disabled = false,
  minDate,
  maxDate,
  startError,
  endError,
  startName = 'start-date',
  endName = 'end-date',
  className,
  inputClassName,
  labelClassName,
}) {
  const uid = useId();
  const startId = `${uid}-start`;
  const endId = `${uid}-end`;
  const showStartRequired = startRequired ?? required;
  const showEndRequired = endRequired ?? required;
  const startMax = minYmd(end, maxDate);
  const endMin = maxYmd(start, minDate);

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-3 gap-y-2 [&>*]:min-w-0',
        className,
      )}
    >
      <DateField
        id={startId}
        name={startName}
        label={startLabel}
        required={showStartRequired}
        value={start}
        min={minDate}
        max={startMax}
        disabled={disabled}
        error={startError}
        inputClassName={inputClassName}
        labelClassName={labelClassName}
        calendarLabel={`${startLabel} calendar`}
        onChange={onStartChange}
      />
      <DateField
        id={endId}
        name={endName}
        label={endLabel}
        required={showEndRequired}
        value={end}
        min={endMin}
        max={maxDate}
        disabled={disabled}
        error={endError}
        inputClassName={inputClassName}
        labelClassName={labelClassName}
        calendarLabel={`${endLabel} calendar`}
        onChange={onEndChange}
      />
    </div>
  );
}
