'use client';

import { useEffect } from 'react';
import { CircleCheck, CirclePlus, CircleX, PencilLine, Trash2, TriangleAlert, X } from 'lucide-react';

import { POPUP_SHADOW_CLASS } from '@/components/ui/popupShadow';
import { cn } from '@/lib/utils';

const DISMISS_AFTER_MS = 4000;
// A white card for every outcome, like the notification panel; the kind of
// outcome is its solid badge, its label and its countdown bar. The icon and
// label say it as well, so it never rests on colour alone (WCAG 1.4.1).
const KINDS = {
  success: {
    Icon: CircleCheck,
    label: 'Saved',
    fill: 'bg-deep-violet-blue',
    halo: 'ring-deep-violet-blue/15',
    text: 'text-deep-violet-blue',
  },
  created: {
    Icon: CirclePlus,
    label: 'Created',
    fill: 'bg-[oklch(0.56_0.13_160)]',
    halo: 'ring-[oklch(0.56_0.13_160/0.18)]',
    text: 'text-[oklch(0.42_0.09_160)]',
  },
  updated: {
    Icon: PencilLine,
    label: 'Updated',
    fill: 'bg-[oklch(0.56_0.13_235)]',
    halo: 'ring-[oklch(0.56_0.13_235/0.18)]',
    text: 'text-[oklch(0.42_0.09_235)]',
  },
  deleted: {
    Icon: Trash2,
    label: 'Deleted',
    fill: 'bg-[oklch(0.56_0.19_25)]',
    halo: 'ring-[oklch(0.56_0.19_25/0.18)]',
    text: 'text-[oklch(0.42_0.13_25)]',
  },
  warning: {
    Icon: TriangleAlert,
    label: 'Heads up',
    fill: 'bg-[oklch(0.64_0.15_65)]',
    halo: 'ring-[oklch(0.64_0.15_65/0.2)]',
    text: 'text-[oklch(0.42_0.09_60)]',
  },
  error: {
    Icon: CircleX,
    label: 'Something went wrong',
    fill: 'bg-[oklch(0.56_0.19_25)]',
    halo: 'ring-[oklch(0.56_0.19_25/0.18)]',
    text: 'text-[oklch(0.42_0.13_25)]',
  },
};

/**
 * Small self-dismissing confirmation in the top right corner of the screen,
 * the same place on every page, e.g. "Thresholds updated successfully". Clicks
 * pass straight through it to whatever is underneath, except on its close
 * button, so it never gets in the way. Every toast is the same size: the
 * message stays on one line and a longer one is cut with "...", so keep
 * messages to about 38 characters. Pair it with hooks/useToast, which owns the
 * state:
 *
 *   const { toast, notify, dismissToast } = useToast();
 *   notify('success', 'Saved');
 *   <Toast toast={toast} onDismiss={dismissToast} />
 *
 * `toast` is `{ id, type, message }` or null, where `type` is one of
 * success (generic save), created, updated, deleted, warning or error; an
 * unknown type falls back to success. A new `id` restarts the timer, so two
 * saves in a row each get their full time on screen. `onDismiss` must keep a
 * stable identity (useToast's does), since the timer effect depends on it.
 *
 * @param {{ toast: { id: number, type: 'success' | 'created' | 'updated' | 'deleted' | 'warning' | 'error', message: string } | null, onDismiss: () => void }} props
 */
export default function Toast({ toast, onDismiss }) {
  const toastId = toast?.id;

  useEffect(() => {
    if (toastId === undefined) return undefined;
    const timer = setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [toastId, onDismiss]);

  if (!toast) return null;

  const { Icon, label, fill, halo, text } = KINDS[toast.type] || KINDS.success;

  // The key replays the entrance and the countdown for each new toast.
  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 max-w-[calc(100vw-2rem)]">
      <div
        key={toast.id}
        role={toast.type === 'error' ? 'alert' : 'status'}
        aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
        className={cn(
          'relative w-96 max-w-full overflow-hidden rounded-2xl border border-lavander bg-white',
          'animate-in fade-in-0 zoom-in-95 slide-in-from-right-2 duration-300 ease-out motion-reduce:animate-none',
          POPUP_SHADOW_CLASS,
        )}
      >
        <div className="flex items-center gap-3 py-3 pr-2.5 pl-3.5">
          <span
            aria-hidden="true"
            className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-white ring-4', fill, halo)}
          >
            <Icon className="size-[18px]" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn('text-[11px] leading-4 font-semibold tracking-wide uppercase', text)}>{label}</p>
            <p className="truncate text-sm leading-snug font-medium text-deep-violet-blue">{toast.message}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="pointer-events-auto flex size-7 shrink-0 cursor-pointer items-center justify-center self-start rounded-full text-deep-violet-blue/60 transition-colors hover:bg-lavander hover:text-deep-violet-blue focus-visible:ring-2 focus-visible:ring-deep-violet-blue focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {/* Shows how long until it goes away; hidden if motion is reduced. */}
        <span
          aria-hidden="true"
          className={cn('toast-countdown absolute inset-x-0 bottom-0 block h-[3px] origin-left motion-reduce:hidden', fill)}
          style={{ animationDuration: `${DISMISS_AFTER_MS}ms` }}
        />
      </div>
    </div>
  );
}
