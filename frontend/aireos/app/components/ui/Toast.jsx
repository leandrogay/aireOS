'use client';

import { useEffect } from 'react';

import { cn } from '@/lib/utils';

const DISMISS_AFTER_MS = 4000;

// One colour per kind of outcome, so a glance says what just happened.
// Solid fills are things that went through; the tinted ones ask for a second
// look. `deleted` is solid red like the "Confirm delete" button, which keeps
// it apart from the tinted red of a failure.
const TONES = {
  success: 'border-deep-violet-blue bg-deep-violet-blue text-white',
  created: 'border-emerald-600 bg-emerald-600 text-white',
  updated: 'border-sky-600 bg-sky-600 text-white',
  deleted: 'border-red-700 bg-red-700 text-white',
  warning: 'border-amber-400 bg-amber-50 text-amber-900',
  error: 'border-red-300 bg-red-50 text-red-800',
};

/**
 * Small self-dismissing confirmation in the top-right corner, e.g.
 * "Thresholds updated successfully". Pair it with hooks/useToast, which owns
 * the state:
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

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed right-4 top-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg',
        TONES[toast.type] || TONES.success,
      )}
    >
      {toast.message}
    </div>
  );
}
