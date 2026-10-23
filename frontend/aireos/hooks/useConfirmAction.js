'use client';

import { useState } from 'react';

/**
 * The "are you sure?" step before an action on one record, usually Delete,
 * for ui/ConfirmDialog:
 *
 *   const deletion = useConfirmAction({ onConfirm: deletePromotion });
 *   …RowActions item: onSelect: () => deletion.request(promotion)
 *   <ConfirmDialog
 *     open={Boolean(deletion.target)}
 *     isPending={deletion.isPending}
 *     onConfirm={deletion.confirm}
 *     onCancel={deletion.cancel}
 *     …
 *   />
 *
 * `onConfirm` runs only from the dialog's confirm button, never from Cancel.
 * Cancel is ignored while it runs, so a request in flight is never abandoned.
 * The dialog closes once it settles, whether it worked or not: `onConfirm`
 * reports its own outcome (a toast with the backend's reason on failure), so
 * it should catch its errors rather than throw them here.
 *
 * @template T
 * @param {{ onConfirm: (target: T) => Promise<void> }} options
 * @returns {{
 *   target: T | null,
 *   isPending: boolean,
 *   request: (target: T) => void,
 *   cancel: () => void,
 *   confirm: () => Promise<void>,
 * }}
 */
export default function useConfirmAction({ onConfirm }) {
  const [target, setTarget] = useState(null);
  const [isPending, setIsPending] = useState(false);

  function request(next) {
    setTarget(next);
  }

  function cancel() {
    if (isPending) return;
    setTarget(null);
  }

  async function confirm() {
    if (!target || isPending) return;
    setIsPending(true);
    try {
      await onConfirm(target);
    } finally {
      setIsPending(false);
      setTarget(null);
    }
  }

  return { target, isPending, request, cancel, confirm };
}
