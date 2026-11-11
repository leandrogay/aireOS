"use client"

// shadcn/ui Tabs (generated via `npx shadcn add tabs`), wrapping @base-ui/react's
// Tabs. Tabs = root wrapper (controlled via value/onValueChange), TabsList = the
// pill/segmented control, TabsTrigger = one selectable option inside it,
// TabsContent = the panel shown for the active tab. A consumer that only needs
// the switch itself (e.g. ModeToggle) can skip TabsContent entirely and drive
// its own rendering off `value`/`onValueChange` instead.
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props} />
  );
}

const tabsListVariants = cva(
  // The same lavender track and white thumb as ui/SegmentedControl (`tint`):
  // the 10px track radius less its 3px padding gives the tabs' 7px.
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-glass-sm p-[3px] text-ink-soft group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-lavander",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props} />
  );
}

function TabsTrigger({
  className,
  ...props
}) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-ink-soft outline-none transition-[color,background-color,border-color,box-shadow] duration-hover ease-standard group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:bg-white/40 hover:text-deep-violet-blue focus-ring-inset disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:border-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // The selected thumb, as plain data-active utilities so a caller's own
        // data-active:bg-* / shadow-* / border-* replaces them in cn() at the
        // same specificity (the line variant's group rules above still win).
        // The 70% deep-blue edge is the 3:1 state cue; the hover above is a
        // fainter white with no edge, so it never reads as selected.
        // data-active:hover keeps the thumb white under the pointer: the
        // data-active variant is a :where(), so plain hover:bg-* would win.
        "data-active:border-deep-violet-blue/70 data-active:bg-white data-active:hover:bg-white data-active:text-deep-violet-blue data-active:shadow-thumb dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-deep-violet-blue after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props} />
  );
}

function TabsContent({
  className,
  ...props
}) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props} />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
