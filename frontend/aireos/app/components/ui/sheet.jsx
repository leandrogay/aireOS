"use client"

// shadcn/ui-style Sheet (style "base-nova"): a panel that slides in from the
// side, on @base-ui/react's Dialog like ui/dialog. Written by hand, not with
// `npx shadcn add sheet`: in this repo the generator asks to overwrite
// button.tsx and installs an unrelated npm package named cn (the same problem
// ui/dialog notes). Base UI handles focus return, Escape and the close button.
//
// `modal={false}` on <Sheet> keeps the page usable beside it (no backdrop,
// no scroll lock), for help that is read next to what it explains.

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function Sheet({
  ...props
}) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

const SIDE_CLASSES = {
  right:
    "inset-y-0 right-0 h-full w-full border-l sm:max-w-md data-open:slide-in-from-right data-closed:slide-out-to-right",
  left:
    "inset-y-0 left-0 h-full w-full border-r sm:max-w-md data-open:slide-in-from-left data-closed:slide-out-to-left",
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}) {
  return (
    <SheetPrimitive.Portal data-slot="sheet-portal">
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "aire-glass-float fixed z-50 flex flex-col gap-3 bg-popover text-sm text-popover-foreground shadow-lg outline-none duration-200 data-open:animate-in data-closed:animate-out",
          SIDE_CLASSES[side],
          className
        )}
        {...props}>
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}>
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({
  className,
  ...props
}) {
  return (
    <div data-slot="sheet-header" className={cn("flex flex-col gap-1 p-4 pb-0", className)} {...props} />
  );
}

function SheetTitle({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props} />
  );
}

function SheetDescription({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props} />
  );
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger }
