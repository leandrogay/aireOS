// shadcn/ui Skeleton (generated via `npx shadcn add skeleton`) — a pulsing
// placeholder block shown where content will appear once it loads. Size and
// colour come from `className`; TableSkeleton builds table rows out of it.
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
