'use client';

import { AlertTriangle, CheckCircle2, HelpCircle, Info } from 'lucide-react';

import { checkSummary, evidenceLines, sortChecks } from '../../utils/mappingChecks';

const LEVEL_STYLES = {
  error: { Icon: AlertTriangle, className: 'text-red-700', box: 'border-red-200 bg-red-50' },
  warning: { Icon: HelpCircle, className: 'text-amber-700', box: 'border-amber-200 bg-amber-50' },
};
const PASSED = { Icon: CheckCircle2, className: 'text-green-700' };
const INFO = { Icon: Info, className: 'text-deep-violet-blue/60' };

function CheckLine({ check }) {
  const style = check.passed ? (check.level === 'info' ? INFO : PASSED) : LEVEL_STYLES[check.level] || INFO;
  const { Icon } = style;
  const evidence = check.passed ? [] : evidenceLines(check.evidence);

  return (
    <li className={`flex items-start gap-2 ${check.passed ? '' : `rounded-md border p-2 ${style.box}`}`}>
      <Icon aria-hidden="true" className={`mt-0.5 size-3.5 shrink-0 ${style.className}`} />
      <div className="min-w-0 text-xs text-deep-violet-blue">
        <p>{check.message}</p>
        {evidence.length > 0 && (
          <ul className="mt-0.5 space-y-0.5 font-mono text-[11px] text-deep-violet-blue/70">
            {evidence.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * What happened when these rules were run on the whole example file: totals
 * reconciled against the file's own footer or pivot, periods against the
 * period the file states, required fields filled, no claim or price column
 * read as revenue. Failures come first with the numbers that disagree; what
 * passed is folded away. `source` says whether these are the proposal's checks
 * or a fresh run on the rules as edited.
 *
 * @param {{ checks: object[], source: 'proposal' | 'preview' }} props
 */
export default function MappingChecks({ checks, source }) {
  if (!checks?.length) return null;
  const sorted = sortChecks(checks);
  const { failed, warnings, passed } = checkSummary(checks);
  const open = sorted.filter((check) => !check.passed);
  const done = sorted.filter((check) => check.passed);

  return (
    <section className="rounded-lg border border-lavander bg-white p-6 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="font-serif text-lg text-deep-violet-blue">Checks on the example file</h3>
          <p className="text-xs text-deep-violet-blue/70">
            {source === 'preview'
              ? 'Re-run on the rules as you have edited them.'
              : 'Run on the proposal before it reached you. Preview your rules to run them again.'}
          </p>
        </div>
        <p className="text-sm font-medium text-deep-violet-blue">
          {failed} failed · {warnings} warning{warnings === 1 ? '' : 's'} · {passed} passed
        </p>
      </div>

      {open.length > 0 && (
        <ul className="mb-3 space-y-2">
          {open.map((check) => (
            <CheckLine key={check.id} check={check} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-deep-violet-blue">
            {done.length} check{done.length === 1 ? '' : 's'} passed
          </summary>
          <ul className="mt-2 space-y-1.5">
            {done.map((check) => (
              <CheckLine key={check.id} check={check} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
