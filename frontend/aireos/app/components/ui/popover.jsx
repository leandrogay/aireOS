"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "@/lib/utils"

function Popover({
  ...props
}) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  positionMethod,
  arrow = false,
  arrowClassName,
  children,
  ...props
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        positionMethod={positionMethod}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "aire-glass-float z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden data-open:duration-(--motion-enter) data-closed:duration-(--motion-exit) data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {/* A triangle centred on the trigger by Base UI, only drawn for popups
              below their trigger (side="bottom"). The popup's outline is a 1px ring
              just outside its top edge (svg rows 6-7): the sides end on that ring's
              centre line and the fill covers the ring under the base, so the outline
              runs into the tip with no notch at any zoom. 14px wide so that, under a
              36px trigger at the popup's end (align="end"), both feet are 12px from
              the edge, on the straight part past the 10px rounded corner rather than
              on its curve. Its colour is the text colour (`arrowClassName`, e.g.
              text-violet/40 to match ring-violet/40). */}
          {arrow && (
            <PopoverPrimitive.Arrow
              data-slot="popover-arrow"
              className={cn("h-[7px] w-3.5 text-foreground/10 data-[side=bottom]:-top-[7px]", arrowClassName)}
            >
              <svg viewBox="0 0 14 7" className="block size-full overflow-visible" aria-hidden="true">
                <path d="M7 0.5 L1 6.5 L1 7 L13 7 L13 6.5 Z" className="fill-popover" />
                <path d="M1 6.5 L7 0.5 L13 6.5" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            </PopoverPrimitive.Arrow>
          )}
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({
  className,
  ...props
}) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({
  className,
  ...props
}) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
