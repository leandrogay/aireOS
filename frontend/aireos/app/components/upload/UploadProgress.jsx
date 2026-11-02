import { cn } from '@/lib/utils';
import { STAGES } from '@/app/utils/uploadFlow';

/**
 * Where a file in flight has got to. Sending has a real percentage. After
 * that the server's steps show as a segmented bar: the steps are real, only
 * their timing is a guess (see STAGES), so there is no percentage to show.
 *
 * @param {{ stage: string, sendPercent: number | null | undefined }} props
 */
export default function UploadProgress({ stage, sendPercent }) {
  if (sendPercent !== null && sendPercent !== undefined) {
    return (
      <div className="mt-2 max-w-sm">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={sendPercent}
          aria-label="Sending file"
          className="h-1.5 overflow-hidden rounded-full bg-lavander"
        >
          <div
            className="h-full rounded-full bg-deep-violet-blue transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${sendPercent}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-deep-violet-blue/70 tabular-nums">Sending, {sendPercent}%</p>
      </div>
    );
  }

  const current = Math.max(0, STAGES.findIndex((entry) => entry.key === stage));

  return (
    <div className="mt-2 max-w-sm">
      <div className="flex gap-1" aria-hidden="true">
        {STAGES.map((entry, index) => (
          <span
            key={entry.key}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              index < current && 'bg-deep-violet-blue',
              index === current && 'animate-pulse bg-violet motion-reduce:animate-none',
              index > current && 'bg-lavander',
            )}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-deep-violet-blue/70">
        Uploading, step {current + 1} of {STAGES.length}: {STAGES[current].label.toLowerCase()}…
      </p>
    </div>
  );
}
