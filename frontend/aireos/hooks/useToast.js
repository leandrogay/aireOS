'use client';

import { useCallback, useState } from 'react';

/**
 * State for one components/ui/Toast: `notify(type, message)` shows a toast
 * (replacing any current one) and `dismissToast` clears it.
 *
 * @returns {{ toast: { id: number, type: 'success' | 'error', message: string } | null, notify: (type: 'success' | 'error', message: string) => void, dismissToast: () => void }}
 */
export default function useToast() {
  const [toast, setToast] = useState(null);

  // Toast lists onDismiss in its timer effect, so it needs a stable identity.
  const dismissToast = useCallback(() => setToast(null), []);

  function notify(type, message) {
    // A fresh id restarts Toast's timer even when the message is the same.
    setToast({ id: Date.now(), type, message });
  }

  return { toast, notify, dismissToast };
}
