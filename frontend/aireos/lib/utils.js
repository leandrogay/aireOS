import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

// Merges className strings/conditionals (clsx), then drops conflicting Tailwind
// utility classes so the last one wins (tailwind-merge) — e.g.
// cn("px-2", isWide && "px-4") correctly keeps only "px-4" instead of emitting
// both. Every shadcn/ui primitive (button, card, tabs, chart...) uses this for
// its `className` prop so callers can override styles without specificity fights.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
