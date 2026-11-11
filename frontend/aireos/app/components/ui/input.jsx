// Added with `npx shadcn add input`; wraps @base-ui/react's Input. The CLI
// wrote `import { cn } from "cn"`, so the import points back at the project's
// own helper like every other primitive.
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  ...props
}) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // The one solid field look (formStyles inputClass, ui/Dropdown).
        "h-8 w-full min-w-0 rounded-glass-sm border border-deep-violet-blue/60 bg-white px-2.5 py-1 text-base text-deep-violet-blue transition-[border-color,background-color] duration-hover outline-none hover:border-deep-violet-blue/75 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-deep-violet-blue placeholder:text-ink-soft focus-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props} />
  );
}

export { Input }
