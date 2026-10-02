'use client';

import { useCallback, useState } from 'react';

/**
 * State for one components/ui/Toast: `notify(type, message)` shows a toast
 * (replacing any current one) and `dismissToast` clears it. `type` picks the
 * colour; see TONES in Toast.jsx.
 *
 * @typedef {'success' | 'created' | 'updated' | 'deleted' | 'warning' | 'error'} ToastType
 * @returns {{ toast: { id: number, type: ToastType, message: string } | null, notify: (type: ToastType, message: string) => void, dismissToast: () => void }}
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
