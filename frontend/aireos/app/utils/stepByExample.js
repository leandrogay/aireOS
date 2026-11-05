import { REGEX_PRESETS, runSamples } from '@/app/utils/transformSteps';

// A step found from examples: the reviewer types what one or two of a
// column's values should become, and every step that turns each example into
// exactly that is a candidate -- the ready-made patterns, patterns built
// around the punctuation and numbers in the example, and, when the result is
// not a part of the value at all, a table of the examples. The candidates are
// ranked by how many of the other values they also give something for, and
// shown with what they make of them, so the reviewer picks by the result
// (one example can fit more than one reading). Every step is one the contract
// already has, in patterns that read the same in Python as in the browser.
// Pure: no React.

// How many candidates are offered.
const MAX_SUGGESTIONS = 3;

// Words are counted to this many, for "keep word n".
const MAX_WORD = 4;

const ORDINALS = ['first', 'second', 'third', 'fourth'];

function escape(char) {
  return char.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

function regexStep(pattern) {
  return { type: 'regex_extract', pattern, group: 1 };
}

/** The punctuation in a value, each mark once, in the order it appears. */
function marks(value) {
  return [...new Set(String(value).match(/[^\p{L}\p{N}\s]/gu) || [])];
}

/**
 * Every reading of an example worth testing, simplest first: the ready-made
 * patterns, then text before, after or between its punctuation, words by
 * position, and the first or last number.
 */
function candidates(examples) {
  const found = REGEX_PRESETS.map((preset) => ({ label: `Keep the part: ${preset.label}`, step: regexStep(preset.pattern) }));

  const punctuation = [...new Set(examples.flatMap((example) => marks(example.before)))];
  punctuation.forEach((mark) => {
    const m = escape(mark);
    found.push(
      { label: `Keep the text before “${mark}”`, step: regexStep(`^\\s*(.*?)\\s*${m}`) },
      { label: `Keep the text after “${mark}”`, step: regexStep(`${m}\\s*(.*?)\\s*$`) },
      { label: `Keep the text after the last “${mark}”`, step: regexStep(`${m}\\s*([^${m}]*?)\\s*$`) },
    );
  });
  punctuation.forEach((open) => {
    punctuation
      .filter((close) => close !== open)
      .forEach((close) => {
        found.push({
          label: `Keep the text between “${open}” and “${close}”`,
          step: regexStep(`${escape(open)}\\s*(.*?)\\s*${escape(close)}`),
        });
      });
  });

  for (let n = 0; n < MAX_WORD; n += 1) {
    found.push({ label: `Keep the ${ORDINALS[n]} word`, step: regexStep(`^\\s*(?:\\S+\\s+){${n}}(\\S+)`) });
  }
  found.push(
    { label: 'Keep the last word', step: regexStep('(\\S+)\\s*$') },
    { label: 'Keep the text before the first number', step: regexStep('^\\s*(\\D*?)\\s*\\d') },
    { label: 'Keep the last number', step: regexStep('(\\d+(?:\\.\\d+)?)\\D*$') },
  );
  return found;
}

function outputsOf(step, values) {
  return runSamples(values, [step]).map((row) => row.after);
}

function fits(step, examples) {
  const outputs = outputsOf(
    step,
    examples.map((example) => example.before),
  );
  return outputs.every((output, index) => output !== null && output.trim() === examples[index].after.trim());
}

/** A table of the examples: for a result that is no part of the value ("FPON" → "Online"). */
function tableFrom(examples) {
  const values = Object.fromEntries(examples.map((example) => [example.before, example.after.trim()]));
  return {
    label: examples.length === 1 ? 'Translate this value' : 'Translate these values',
    step: { type: 'value_map', values, case_sensitive: false },
    table: true,
  };
}

/**
 * The steps that turn every example into what the reviewer typed, best
 * first, each with what it makes of `values` (the column's values as they
 * reach the new step) and how many of them it gives nothing for. Two
 * readings that agree on every value are one suggestion. A table of the
 * examples is offered when no pattern fits, and after them when the result
 * is not part of the value. Empty while an example has no result yet, or
 * when every example is already what it should become.
 *
 * @param {string[]} values
 * @param {{ before: string, after: string }[]} examples
 * @returns {{ label: string, step: object, outputs: (string | null)[], missing: number, table?: boolean }[]}
 */
export function suggestSteps(values, examples) {
  const ready = examples.filter((example) => String(example.after).trim());
  if (!ready.length || ready.length < examples.length) return [];
  if (ready.every((example) => example.before.trim() === example.after.trim())) return [];

  const seen = new Set();
  const matches = [];
  candidates(ready)
    .filter((candidate) => fits(candidate.step, ready))
    .forEach((candidate, order) => {
      const outputs = outputsOf(candidate.step, values);
      const key = JSON.stringify(outputs);
      if (seen.has(key)) return;
      seen.add(key);
      matches.push({ ...candidate, outputs, missing: outputs.filter((output) => output === null).length, order });
    });
  matches.sort((a, b) => a.missing - b.missing || a.order - b.order);
  const best = matches.slice(0, MAX_SUGGESTIONS).map(({ order, ...rest }) => rest);

  const inside = ready.every((example) => example.before.toLowerCase().includes(example.after.trim().toLowerCase()));
  if (best.length && inside) return best;
  const table = tableFrom(ready);
  const outputs = outputsOf(table.step, values);
  return [...best, { ...table, outputs, missing: outputs.filter((output) => output === null).length }];
}
