'use client';

import { useEffect } from 'react';

import { cn } from '@/lib/utils';

const DISMISS_AFTER_MS = 4000;

/**
 * Small self-dismissing confirmation, e.g. "Thresholds updated successfully".
 * The parent owns the toast: `{ id, type: 'success' | 'error', message }` or
 * null. A new `id` restarts the timer, so two saves in a row each get their
 * full time on screen.
 *
 * @param {{ toast: { id: number, type: 'success' | 'error', message: string } | null, onDismiss: () => void }} props
 */
export default function InventoryToast({ toast, onDismiss }) {
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
        'fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg',
        toast.type === 'error'
          ? 'border-red-300 bg-red-50 text-red-800'
          : 'border-deep-violet-blue bg-deep-violet-blue text-white',
      )}
    >
      {toast.message}
    </div>
  );
}
