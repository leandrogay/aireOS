'use client';

import { AlertTriangle, CheckCircle2, HelpCircle, Info } from 'lucide-react';

import Disclosure from '@/components/ui/Disclosure';
import { evidenceLines, sortChecks } from '../../utils/mappingChecks';

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
        <p>
          {!check.passed && check.level === 'error' && <span className="font-medium">Blocks approval: </span>}
          {check.message}
        </p>
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
 * What the checks found when these rules were run on the whole example file:
 * totals against the file's own footer, periods against the period it states,
 * required fields filled, no claim or price column read as revenue. Failures
 * come first with the numbers that disagree, an error marked as what blocks
 * approval; what passed is folded away. Shown inside its review step, which
 * carries the heading and says how fresh the results are.
 *
 * While `stale` (the mapping changed since they ran) the passes are said to be
 * the old mapping's, muted, so they do not vouch for what is on screen now.
 *
 * @param {{ checks: object[], stale?: boolean }} props
 */
export default function MappingChecks({ checks, stale = false }) {
  if (!checks?.length) {
    return <p className="text-xs text-deep-violet-blue/70">No checks have been run on this mapping yet.</p>;
  }
  const sorted = sortChecks(checks);
  const open = sorted.filter((check) => !check.passed);
  const done = sorted.filter((check) => check.passed);

  return (
    <div>
      {open.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {open.map((check) => (
            <CheckLine key={check.id} check={check} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <Disclosure
          variant="link"
          className={stale ? 'opacity-70' : undefined}
          summary={`${done.length} check${done.length === 1 ? '' : 's'} passed${stale ? ' before your changes' : ''}`}
        >
          <ul className="mt-2 space-y-1.5">
            {done.map((check) => (
              <CheckLine key={check.id} check={check} />
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}
