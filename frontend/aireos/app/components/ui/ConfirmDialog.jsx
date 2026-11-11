'use client';

import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';

import { Button } from '@/components/ui/button';
import { DIALOG_BACKDROP_CLASS } from '@/components/ui/dialog';
import { MOTION_DURATION, MOTION_EASE, SPRINGS } from '@/app/config/transitions';
import { cn } from '@/lib/utils';

// The same materialise / dematerialise as ui/dialog (its .motion-dialog CSS):
// the panel fades in while scaling up from 96% on the dialog spring and leaves
// faster on the exit ease; the scrim fades with it.
const PANEL_MOTION = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { ...SPRINGS.dialog, opacity: { duration: MOTION_DURATION.popover } } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: MOTION_DURATION.dialogExit, ease: MOTION_EASE.exit } },
};
const SCRIM_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: MOTION_DURATION.dialog, ease: MOTION_EASE.standard } },
  exit: { opacity: 0, transition: { duration: MOTION_DURATION.dialogExit, ease: MOTION_EASE.exit } },
};

// The confirm button's colour says how serious the action is: red for
// anything that cannot be undone, the brand navy otherwise.
// `tone` picks the confirm button's Button variant.
const CONFIRM_VARIANTS = {
  destructive: 'destructive',
  default: 'default',
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
 *   confirmDisabled?: boolean,
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
  confirmDisabled = false,
  onConfirm,
  onCancel,
}) {
  // useId so two dialogs on one page never share aria ids.
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const reduceMotion = useReducedMotion();

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

  if (typeof document === 'undefined') return null;

  // Closing keeps the dialog on screen for its exit (MOTION_DURATION.dialogExit,
  // 200ms), as it was when it closed: AnimatePresence holds the last rendered
  // layer, so its text doesn't change as the page clears its state. The
  // Escape listener above still goes the moment `open` turns false, and
  // onConfirm / onCancel fire exactly when they did; the leaving layer is
  // inert (ConfirmLayer), so it takes no clicks or focus.
  return createPortal(
    <AnimatePresence>
      {open && (
        <ConfirmLayer
          key="confirm"
          onBackdropClick={() => {
            if (!isPending) onCancel();
          }}
        >
          {/* motion.div renders the same div, with the same role, aria and
              click handler; the motion sits on the glass panel itself, since an
              ancestor fading its opacity would stop the panel blurring the page. */}
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            className="glass-3 relative z-50 w-full max-w-md rounded-glass-lg p-4"
            onClick={(event) => event.stopPropagation()}
            {...surfaceMotion(PANEL_MOTION, reduceMotion)}
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
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-glass-sm border border-(--aire-card-border) bg-white px-3 py-2.5 text-sm">
                {details.map((detail) => (
                  <div key={detail.label} className="contents">
                    <dt className="text-ink-soft">{detail.label}</dt>
                    <dd className="min-w-0 break-words font-medium text-deep-violet-blue">
                      {detail.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {children}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
                {cancelLabel}
              </Button>
              <Button
                type="button"
                variant={CONFIRM_VARIANTS[tone] || CONFIRM_VARIANTS.destructive}
                onClick={onConfirm}
                disabled={isPending || confirmDisabled}
              >
                {isPending ? pendingLabel : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </ConfirmLayer>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// motion props for one animated part; reduced motion: no entrance, no exit.
function surfaceMotion(variants, reduceMotion) {
  return {
    variants,
    initial: reduceMotion ? false : 'initial',
    animate: 'animate',
    exit: reduceMotion ? undefined : 'exit',
  };
}

/**
 * The full-screen layer: the click-to-cancel wrapper and the scrim, around
 * the panel (`children`). While it is leaving (useIsPresent false) it is
 * inert and click-through, so the page under it works at once, as when it
 * used to vanish, and a focused button inside lets go of focus.
 *
 * @param {{ onBackdropClick: () => void, children: import('react').ReactNode }} props
 */
function ConfirmLayer({ onBackdropClick, children }) {
  const isPresent = useIsPresent();
  const reduceMotion = useReducedMotion();

  return (
    <div
      inert={!isPresent || undefined}
      className={cn('fixed inset-0 z-50 flex items-center justify-center px-4', !isPresent && 'pointer-events-none')}
      onClick={onBackdropClick}
    >
      {/* The scrim is a sibling of the panel, not its parent: a backdrop-filter
          on an ancestor would stop the glass panel blurring the page. A click
          on it still reaches the wrapper above. */}
      <motion.div aria-hidden="true" className={DIALOG_BACKDROP_CLASS} {...surfaceMotion(SCRIM_MOTION, reduceMotion)} />
      {children}
    </div>
  );
}
