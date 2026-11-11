"use client"

// Added with `npx shadcn add switch`; wraps @base-ui/react's Switch. The CLI
// wrote `import { cn } from "cn"` (an unrelated npm package), so the import
// below points back at the project's own helper like every other primitive.
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // An iOS-style pill: a filled track, a white thumb with a soft drop
        // shadow and a slight spring as it slides. Colours are the switch
        // tokens in globals.css, chosen to keep 3:1 on every glass surface
        // in both themes; the off edge is an inset shadow so it never shifts
        // the layout and still sits under the focus ring.
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full p-0.5 outline-none transition-colors duration-200 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        "data-[size=default]:h-[22px] data-[size=default]:w-[38px] data-[size=sm]:h-4 data-[size=sm]:w-7",
        "data-checked:bg-switch-on data-unchecked:bg-switch-off data-unchecked:shadow-[inset_0_0_0_1px_var(--color-switch-off-edge)]",
        // Disabled (a save in flight) keeps its colours at 80%, so the state
        // it is about to leave still reads; WCAG exempts inactive controls.
        // No not-allowed cursor: every caller disables the switch only for
        // the moment its save is in flight, so the cursor would flash a "no"
        // sign mid-slide right after a click.
        "data-disabled:opacity-80",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.22),0_2px_6px_rgb(0_0_0/0.14)] transition-[translate,background-color] duration-200 ease-[cubic-bezier(0.3,1.35,0.5,1)] motion-reduce:transition-none data-checked:bg-switch-thumb-on data-unchecked:bg-switch-thumb-off group-data-[size=default]/switch:size-[18px] group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3 data-unchecked:translate-x-0 group-data-disabled/switch:shadow-none"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
