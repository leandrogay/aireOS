'use client';

import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

// The confirm button's colour says how serious the action is: red for
// anything that cannot be undone, the brand navy otherwise.
const CONFIRM_TONES = {
  destructive: 'border-red-700 bg-red-700',
  default: 'border-deep-violet-blue bg-deep-violet-blue',
};

/**
 * "Are you sure?" dialog for any action worth a second look: deleting,
 * discarding, overwriting. The page owns the state; this only shows it.
 *
 *   <ConfirmDialog
 *     open={Boolean(pendingDelete)}
 *     title="Delete this promotion?"
 *     description="It will be removed permanently. This can’t be undone."
 *     details={[{ label: 'Offer', value: '5% Off · Monthly' }]}
 *     confirmLabel="Delete promotion"
 *     pendingLabel="Deleting…"
 *     isPending={isDeleting}
 *     onConfirm={confirmDelete}
 *     onCancel={cancelDelete}
 *   />
 *
 * `details` (optional) renders a label / value summary box, so the user can
 * check it is the right record before confirming. `children` (optional) is
 * shown under it for anything a summary box cannot say.
 *
 * Escape, a backdrop click and Cancel all call `onCancel`; all three are
 * ignored while `isPending`, so a request in flight is never abandoned.
 *
 * @param {{
 *   open: boolean,
 *   title: string,
 *   description?: import('react').ReactNode,
 *   details?: Array<{ label: string, value: import('react').ReactNode }>,
 *   children?: import('react').ReactNode,
 *   confirmLabel: string,
 *   pendingLabel?: string,
 *   cancelLabel?: string,
 *   tone?: 'destructive' | 'default',
 *   isPending?: boolean,
 *   onConfirm: () => void,
 *   onCancel: () => void,
 * }} props
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  details,
  children,
  confirmLabel,
  pendingLabel = 'Working…',
  cancelLabel = 'Cancel',
  tone = 'destructive',
  isPending = false,
  onConfirm,
  onCancel,
}) {
  // useId so two dialogs on one page never share aria ids.
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  useEffect(() => {
    if (!open) return;

    /**
     * @param {KeyboardEvent} event
     */
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isPending) onCancel();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, isPending, onCancel]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-deep-violet-blue/40 px-4"
      onClick={() => {
        if (!isPending) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="w-full max-w-md rounded-lg border border-lavander bg-white p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="font-serif text-lg text-deep-violet-blue">
          {title}
        </h3>
        {description && (
          <p id={descriptionId} className="mt-1.5 text-sm text-deep-violet-blue/80">
            {description}
          </p>
        )}
        {details?.length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md border border-lavander bg-cream/50 px-3 py-2.5 text-sm">
            {details.map((detail) => (
              <div key={detail.label} className="contents">
                <dt className="text-deep-violet-blue/60">{detail.label}</dt>
                <dd className="min-w-0 break-words font-medium text-deep-violet-blue">
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-deep-violet-blue/30 bg-white px-3 py-1.5 text-sm font-medium text-deep-violet-blue hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60',
              CONFIRM_TONES[tone] || CONFIRM_TONES.destructive,
            )}
          >
            {isPending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
