import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge"

// tailwind-merge only knows Tailwind's default scale, so it would keep both
// `rounded-glass-sm` and a caller's `rounded-md` (and let the stylesheet's
// order pick one). Teaching it the Liquid Glass tokens from app/globals.css
// (@theme inline) lets a caller's radius, shadow, duration or easing win, as
// every other utility does.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["glass-sm", "glass-md", "glass-lg"],
      shadow: ["glass-1", "glass-2", "glass-3", "card", "thumb"],
      ease: ["standard", "enter", "exit"],
    },
    classGroups: {
      duration: [{ duration: ["press", "hover", "popover", "dialog", "page"] }],
      // globals.css press-transition: a caller's transition-* replaces it.
      transition: ["press-transition"],
    },
  },
})

// Merges className strings/conditionals (clsx), then drops conflicting Tailwind
// utility classes so the last one wins (tailwind-merge) — e.g.
// cn("px-2", isWide && "px-4") correctly keeps only "px-4" instead of emitting
// both. Every shadcn/ui primitive (button, card, tabs, chart...) uses this for
// its `className` prop so callers can override styles without specificity fights.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
