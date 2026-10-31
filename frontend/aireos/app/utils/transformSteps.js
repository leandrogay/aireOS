// The steps a value goes through on its way into a field (backend
// mapping_contract.TRANSFORM_TYPES, run by apply_contract), in a reviewer's
// words: what each does, what it needs, and a run of the column's sample
// values through them in the browser, so a step can be judged before the
// mapping is tested. The browser run is a guide only -- Test runs the real
// transformation on the whole file -- and steps that need the rest of the row
// (multiply, unit conversion, fill from above) are left to it.

import { MEASURE_FIELDS } from '@/app/utils/mappingReview';

// ============================================================
// The vocabulary
// ============================================================

// `kinds` are the fields a step makes sense for: 'text' (store, product…),
// 'number' (units sold, sales value) and 'date' (the period). The add-a-step
// menu lists those first; the rest stay reachable under a second heading.
export const STEP_TYPES = [
  {
    type: 'regex_extract',
    label: 'Take part of the text',
    help: 'Keep only the part a pattern finds, e.g. the size in “AIRE PANTS XL 10S”.',
    kinds: ['text', 'number', 'date'],
  },
  {
    type: 'value_map',
    label: 'Translate values',
    help: 'Swap each value for another from a table. Anything not listed gets the fallback, or is left empty.',
    kinds: ['text', 'date'],
  },
  {
    type: 'rules',
    label: 'Set by rules',
    help: 'The first rule that matches decides the value. Anything no rule matches gets the fallback, or is left empty.',
    kinds: ['text', 'date'],
  },
  { type: 'negate', label: 'Flip the sign', help: 'For files that record sales as negative numbers.', kinds: ['number'] },
  {
    type: 'zero_as_empty',
    label: '0 means no sale',
    help: 'A 0 is left out instead of loaded as a row that sold nothing.',
    kinds: ['number'],
  },
  { type: 'month_start', label: 'Use the month of a date', help: 'A date becomes the month it falls in.', kinds: ['date'] },
  {
    type: 'forward_fill',
    label: 'Fill blanks from above',
    help: 'A blank cell takes the value of the row above, as merged date cells need.',
    kinds: ['text', 'number', 'date'],
  },
  {
    type: 'multiply',
    label: 'Multiply by a column',
    help: "Times the same row's value in another column, e.g. units × unit price.",
    kinds: ['number'],
  },
  {
    type: 'uom_factor',
    label: 'Convert by unit of measure',
    help: 'Multiply by a factor that depends on a unit column, e.g. cartons to packs.',
    kinds: ['number'],
  },
];

const STEP_INFO = Object.fromEntries(STEP_TYPES.map((step) => [step.type, step]));

// The field holding a date; the measures hold figures, every other field text.
const DATE_FIELDS = ['period_start'];

function fieldKind(field) {
  if (MEASURE_FIELDS.includes(field)) return 'number';
  if (DATE_FIELDS.includes(field)) return 'date';
  return 'text';
}

/**
 * The add-a-step menu for a field, as SelectDropdown groups: the steps that
 * suit its kind of value first, then the rest under their own heading, so
 * the usual ones are not buried and an unusual one is still there. A field
 * not given lists every step at once.
 */
export function stepMenu(field) {
  const option = (item) => ({ value: item.type, label: item.label, description: item.help });
  if (!field) return [{ options: STEP_TYPES.map(option) }];
  const kind = fieldKind(field);
  const fits = STEP_TYPES.filter((item) => item.kinds.includes(kind));
  const others = STEP_TYPES.filter((item) => !item.kinds.includes(kind));
  return [
    { options: fits.map(option) },
    { label: `Usually for ${kind === 'number' ? 'text or dates' : kind === 'date' ? 'text or figures' : 'figures or dates'}`, options: others.map(option) },
  ];
}

/** A step type's label, falling back to its stored name for one added later. */
export function stepLabel(type) {
  return STEP_INFO[type]?.label || type;
}

/** One line on what a step type does. */
export function stepHelp(type) {
  return STEP_INFO[type]?.help || '';
}

// Ready-made patterns for "Take part of the text". The round brackets mark
// the part kept (the pattern's first group, unless another is chosen).
export const REGEX_PRESETS = [
  { label: 'Size (S/M, L, XL)', pattern: String.raw`\b(S/M|XL|L)\b` },
  { label: 'Text before ^', pattern: '^([^^]+)' },
  { label: 'Pack count (10S → 10)', pattern: String.raw`(\d+)S\b` },
  { label: 'First number', pattern: String.raw`(\d+(?:\.\d+)?)` },
  { label: 'Date at the end (dd-mm-yyyy)', pattern: String.raw`(\d{2}-\d{2}-\d{4})$` },
];

// backend mapping_contract.RULE_OPS, as the retailer step words them.
export const RULE_OPS = [
  { value: 'equals', label: 'is' },
  { value: 'startswith', label: 'starts with' },
  { value: 'endswith', label: 'ends with' },
  { value: 'contains', label: 'contains' },
  { value: 'regex', label: 'matches pattern' },
];

/** A new step of this type, with empty settings to fill in. */
export function newStep(type) {
  switch (type) {
    case 'regex_extract':
      return { type, pattern: REGEX_PRESETS[0].pattern, group: 1 };
    case 'value_map':
      return { type, values: { '': '' }, case_sensitive: false };
    case 'rules':
      return { type, rules: [{ op: 'equals', value: '', output: '' }], case_sensitive: false };
    case 'multiply':
      return { type, column: '' };
    case 'uom_factor':
      return { type, column: '', factors: { '': 1 }, default: 1 };
    default:
      return { type };
  }
}

// ============================================================
// What is wrong with a step, before the server says so
// ============================================================

// Python names a group (?P<name>...); a browser regex says (?<name>...).
function jsPattern(pattern) {
  return String(pattern || '').replace(/\(\?P</g, '(?<');
}

function compile(pattern, flags = '') {
  try {
    return new RegExp(jsPattern(pattern), flags);
  } catch {
    return null;
  }
}

function groupCount(pattern) {
  const compiled = compile(`${jsPattern(pattern)}|`);
  return compiled ? compiled.exec('').length - 1 : 0;
}

/**
 * Why a step will not work as set, or ''. Mirrors the server's checks
 * (mapping_contract.validate_transforms) closely enough to say so at once;
 * the server's word on Test is final. Nothing here stops the step being kept.
 */
export function stepProblem(step, columns = []) {
  switch (step.type) {
    case 'regex_extract': {
      if (!step.pattern) return 'Type a pattern.';
      if (!compile(step.pattern)) return 'This is not a valid pattern.';
      const groups = groupCount(step.pattern);
      if (groups < 1) return 'Put round brackets around the part to keep.';
      if ((step.group || 1) > groups) return `The pattern has ${groups} bracketed part${groups === 1 ? '' : 's'}.`;
      return '';
    }
    case 'value_map': {
      const pairs = Object.entries(step.values || {}).filter(([from, to]) => from.trim() && String(to).trim());
      return pairs.length ? '' : 'Add at least one value and what it becomes.';
    }
    case 'rules': {
      const rules = step.rules || [];
      if (!rules.length) return 'Add a rule.';
      if (rules.some((rule) => !String(rule.value).trim() || !String(rule.output).trim())) {
        return 'Every rule needs a value to match and a result.';
      }
      if (rules.some((rule) => rule.op === 'regex' && !compile(rule.value))) return 'A rule pattern is not valid.';
      return '';
    }
    case 'multiply':
    case 'uom_factor':
      if (!step.column) return 'Choose a column.';
      if (columns.length && !columns.includes(step.column)) return `“${step.column}” is not a column of this file.`;
      return '';
    default:
      return '';
  }
}

// ============================================================
// Running the samples through
// ============================================================

const PER_ROW = 'Worked out row by row when you test the nomenclature.';

function blank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/** Whether one rule (rules step, backend _rule_matches) matches a value. */
export function ruleMatches(rule, text, caseSensitive) {
  if (rule.op === 'regex') return Boolean(compile(rule.value, caseSensitive ? '' : 'i')?.test(text));
  const [actual, expected] = caseSensitive
    ? [text, String(rule.value)]
    : [text.toLowerCase(), String(rule.value).toLowerCase()];
  if (rule.op === 'equals') return actual === expected;
  if (rule.op === 'startswith') return actual.startsWith(expected);
  if (rule.op === 'endswith') return actual.endsWith(expected);
  return actual.includes(expected);
}

function fallback(step) {
  return step.default !== undefined && step.default !== '' ? step.default : null;
}

// The month of a date, as the period it reads as. Only ISO-style dates are
// read here; any other format is left to the test.
function monthOf(text) {
  const match = /^(\d{4})-(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-01` : undefined;
}

function runStep(value, step) {
  if (step.type === 'forward_fill' || step.type === 'multiply' || step.type === 'uom_factor') {
    return { value, note: PER_ROW, stop: true };
  }
  if (blank(value)) return { value: null };
  const text = String(value).trim();

  switch (step.type) {
    case 'regex_extract': {
      const match = compile(step.pattern)?.exec(text);
      return match ? { value: match[step.group || 1] ?? null } : { value: null, note: 'No match' };
    }
    case 'value_map': {
      const caseSensitive = step.case_sensitive === true;
      const key = caseSensitive ? text : text.toLowerCase();
      const hit = Object.entries(step.values || {}).find(([from]) => (caseSensitive ? from : from.toLowerCase()) === key);
      return hit ? { value: hit[1] } : { value: fallback(step), note: 'Not in the table' };
    }
    case 'rules': {
      const rule = (step.rules || []).find((item) => ruleMatches(item, text, step.case_sensitive === true));
      return rule ? { value: rule.output } : { value: fallback(step), note: 'No rule matches' };
    }
    case 'negate': {
      const number = Number(text);
      return Number.isNaN(number) ? { value: null, note: 'Not a number' } : { value: String(-number) };
    }
    case 'zero_as_empty':
      return Number(text) === 0 ? { value: null, note: 'Left out' } : { value: text };
    case 'month_start': {
      const month = monthOf(text);
      return month ? { value: month } : { value: text, note: PER_ROW, stop: true };
    }
    default:
      return { value: text, note: PER_ROW, stop: true };
  }
}

/**
 * Each sample value and what the steps make of it.
 *
 * @param {string[]} samples
 * @param {object[]} steps
 * @returns {{ before: string, after: string | null, note: string }[]}
 */
export function runSamples(samples, steps) {
  return samples.map((before) => {
    let value = before;
    let note = '';
    for (const step of steps) {
      if (stepProblem(step)) {
        note = 'A step needs fixing';
        break;
      }
      const result = runStep(value, step);
      value = result.value;
      if (result.note) note = result.note;
      if (result.stop) break;
    }
    return { before, after: value === null || value === undefined ? null : String(value), note };
  });
}
