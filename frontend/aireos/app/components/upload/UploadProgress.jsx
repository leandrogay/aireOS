'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  checkedFacts,
  isStillWorking,
  uploadPercent,
  waitExpectation,
} from '@/app/utils/uploadProgress';

// Often enough that the width transition below runs into the next tick, so
// the bar moves continuously rather than in steps.
const TICK_MS = 200;

/**
 * Where a file in flight has got to: one bar from the first byte sent to the
 * response. Sending has a real percentage; the server's part is an estimate
 * sized by the pre-upload check (see utils/uploadProgress), and reaches 100%
 * only when the response lands (`finished`).
 *
 * @param {{
 *   sendPercent: number | null | undefined,
 *   sentAt: number | null | undefined,
 *   finished: boolean | undefined,
 *   check: object | null | undefined,
 * }} props
 */
export default function UploadProgress({ sendPercent, sentAt, finished, check }) {
  const [serverElapsedMs, setServerElapsedMs] = useState(null);

  useEffect(() => {
    if (!sentAt || finished) return undefined;
    const handle = setInterval(() => setServerElapsedMs(Date.now() - sentAt), TICK_MS);
    return () => clearInterval(handle);
  }, [sentAt, finished]);

  const { expectedMs, label, hint } = waitExpectation(check);
  const sending = !sentAt;
  const elapsed = sending ? null : (serverElapsedMs ?? 0);
  const percent = uploadPercent({ sendPercent, serverElapsedMs: elapsed, expectedMs, finished });
  const facts = checkedFacts(check);

  let status = `Sending, ${sendPercent || 0}%`;
  if (finished) status = 'Done';
  else if (!sending) status = `${label}…`;

  return (
    <div className="mt-2 max-w-sm">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={status}
        aria-label="Uploading file"
        className="h-1.5 overflow-hidden rounded-full bg-lavander"
      >
        <div
          className="h-full rounded-full bg-deep-violet-blue transition-[width] duration-300 ease-linear motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-deep-violet-blue/70 tabular-nums">
        {status}
        {!sending && !finished && hint && <span className="text-deep-violet-blue/50"> {hint}</span>}
      </p>
      {facts.length > 0 && (
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-deep-violet-blue/60">
          {facts.map((fact) => (
            <span key={fact} className="inline-flex items-center gap-1">
              <Check className="size-3 text-green-700" aria-hidden="true" />
              {fact}
            </span>
          ))}
        </p>
      )}
      {!finished && isStillWorking(elapsed, expectedMs) && (
        <p className="mt-0.5 text-xs text-deep-violet-blue/60" role="status">
          Still working. Larger files can take up to a minute.
        </p>
      )}
    </div>
  );
}
