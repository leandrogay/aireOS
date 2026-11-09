'use client';

import { CheckCircle2, CircleAlert, FlaskConical, Loader2, RotateCw } from 'lucide-react';

import Disclosure from '@/components/ui/Disclosure';
import { Button } from '@/components/ui/button';
import { GUIDED_STEPS, stepForCheck } from '@/app/utils/guidedSteps';
import { checkSummary } from '@/app/utils/mappingChecks';
import { cn } from '@/lib/utils';

import MappingChecks from '../mappings/MappingChecks';
import OutputPreview from '../mappings/OutputPreview';

// The fields worth reading in a test's sample rows (as on the full review).
const PREVIEW_FIELDS = ['period_start', 'period_type', 'retailer', 'store_code', 'store_name', 'sku', 'quantity_units', 'revenue'];

/**
 * "Let's test it": one big button that runs the nomenclature on the whole
 * example file without saving (POST /api/mappings/{fp}/preview), then the
 * verdict in a sentence, what the checks found, and a sample of the rows it
 * makes. A failing check offers the screen that fixes it.
 *
 * @param {{
 *   review: ReturnType<import('@/hooks/useGuidedReview').default>,
 *   steps: string[],
 *   onGoTo: (key: string) => void,
 *   disabled: boolean,
 * }} props
 */
export default function TestStep({ review, steps, onGoTo, disabled }) {
  const { checks, stale, failed, preview, previewError, busy, issues } = review;
  const testing = busy === 'preview';
  const { warnings } = checkSummary(checks);
  const missingFields = issues.missingRequired.map((entry) => entry.field);
  // One button per screen that fixes something, however many checks point there.
  const fixes = [
    ...new Set(
      (checks || [])
        .filter((check) => !check.passed && check.level === 'error')
        .map((check) => stepForCheck(check, steps, missingFields)),
    ),
  ];

  let verdict;
  if (stale) verdict = { tone: 'todo', text: preview ? 'You’ve made changes since the last test.' : 'Run the test to see how your answers read the file.' };
  else if (failed) verdict = { tone: 'bad', text: `${failed} ${failed === 1 ? 'check fails' : 'checks fail'}. Fix ${failed === 1 ? 'it' : 'them'}, then test again.` };
  else verdict = { tone: 'good', text: warnings ? `Passing, with ${warnings} ${warnings === 1 ? 'note' : 'notes'} to read.` : 'Passing. Every check agrees with the file.' };

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        <Button
          type="button"
          size="lg"
          variant={stale ? 'default' : 'outline'}
          onClick={review.runChecks}
          disabled={disabled}
          className="h-auto min-h-11 md:w-64"
        >
          {testing ? <Loader2 aria-hidden="true" className="animate-spin" /> : preview ? <RotateCw aria-hidden="true" /> : <FlaskConical aria-hidden="true" />}
          {testing ? 'Testing the whole file…' : preview && !stale ? 'Test again' : 'Test it on the example file'}
        </Button>

        <div
          role="status"
          className={cn(
            'flex flex-1 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium',
            verdict.tone === 'good' && 'border-green-200 bg-green-50 text-green-800',
            verdict.tone === 'bad' && 'border-red-200 bg-red-50 text-red-800',
            verdict.tone === 'todo' && 'border-amber-300 bg-amber-50 text-amber-900',
          )}
        >
          {verdict.tone === 'good' ? <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" /> : <CircleAlert aria-hidden="true" className="size-5 shrink-0" />}
          {verdict.text}
        </div>
      </div>

      {previewError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {previewError}
        </p>
      )}

      {!stale && fixes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-deep-violet-blue">Fix it on:</span>
          {fixes.map((key) => (
            <Button key={key} type="button" variant="outline" size="sm" onClick={() => onGoTo(key)} disabled={disabled}>
              {GUIDED_STEPS[key].label}
            </Button>
          ))}
        </div>
      )}

      {preview?.preview_error && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No sample rows: {preview.preview_error}
        </p>
      )}

      <div className="rounded-lg border border-lavander p-3">
        <p className="mb-2 text-sm font-medium text-deep-violet-blue">
          What the checks found
          <span className="font-normal text-deep-violet-blue/80"> · {preview ? 'from your last test' : 'from when the AI proposed it'}</span>
        </p>
        <MappingChecks checks={checks} stale={stale} />
      </div>

      {preview?.preview?.length > 0 && (
        <Disclosure open className="rounded-lg border border-lavander bg-white" summary="Sample sales rows">
          <div className="border-t border-lavander p-2">
            <OutputPreview preview={preview} fields={PREVIEW_FIELDS} />
          </div>
        </Disclosure>
      )}
    </>
  );
}
