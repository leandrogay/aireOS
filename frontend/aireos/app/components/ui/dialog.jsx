"use client"

// shadcn/ui Dialog (generated via `npx shadcn add dialog`, style "base-nova").
// Wraps @base-ui/react's Dialog, which handles the focus trap, focus return,
// scroll lock, Escape and backdrop close. Use it controlled from the page:
// <Dialog open={...} onOpenChange={(open) => ...}>. Note the generator wrote
// `import { cn } from "cn"` (and installed an unrelated npm package named
// cn); the import is corrected to @/lib/utils below. DialogContent's grid also
// gets `grid-cols-1` (minmax(0, 1fr)): with the default auto column, wide
// content (a table) stretched the column past the popup, so a dialog drawn as
// a card inside a transparent popup ran past it and the close button sat
// short of the card's corner.

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

// The dimmed, blurred page behind a dialog; the assistant's full screen and
// ui/ConfirmDialog use it too. A deep-blue scrim (not grey) strong enough that
// the glass dialog reads as a separate layer over a busy page.
export const DIALOG_BACKDROP_CLASS =
  "fixed inset-0 isolate z-50 bg-deep-violet-blue/30 supports-backdrop-filter:backdrop-blur-xs"

function DialogOverlay({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        DIALOG_BACKDROP_CLASS,
        "duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props} />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "glass-3 fixed top-1/2 left-1/2 z-50 grid w-full grid-cols-1 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-glass-lg p-4 text-sm text-deep-violet-blue duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          // A dialog drawn as a card inside a transparent popup (callers pass
          // `bg-transparent p-0 ring-0`) brings its own frame, so the glass
          // border, rim, shadow and blur are dropped too: otherwise a blurred
          // halo would show round the card's corners.
          "[&.bg-transparent]:border-0 [&.bg-transparent]:shadow-none [&.bg-transparent]:inset-shadow-none [&.bg-transparent]:backdrop-blur-none",
          className
        )}
        {...props}>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />
            }>
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({
  className,
  ...props
}) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // The popup's corner less its 1px border, so the tint fills the curve.
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-[calc(var(--glass-radius-lg)-1px)] border-t border-deep-violet-blue/10 bg-deep-violet-blue/[0.03] p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}>
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props} />
  );
}

function DialogDescription({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-ink-soft *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-deep-violet-blue",
        className
      )}
      {...props} />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
