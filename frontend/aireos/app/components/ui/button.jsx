// shadcn/ui Button (generated via `npx shadcn add button`, style "base-nova"),
// restyled with the AIRE brand tokens from app/globals.css (deep-violet-blue,
// cream, lavander, violet, scenario). Use this instead of a raw <button> so
// colour, height and focus ring stay the same on every page. The shadcn
// variant names are kept, so existing <Button variant="outline"> calls pick up
// the brand look without edits. See app/testing for every variant and size.
//
// Not for toggles, tabs, chips or menu rows: those have their own primitives
// (SegmentedControl, ToggleButton, Dropdown); see CONTRIBUTING.md.
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

// cva maps `variant` and `size` to a Tailwind class string.
//
// Every variant has a 1px border, transparent on the filled ones, so all
// variants share one box. shadcn's `bg-clip-padding` is left out on purpose:
// it stopped the fill inside that transparent border, so a filled button
// looked 2px smaller than an outline one beside it (Cancel / Rollback upload). The brand colours
// are fixed hexes (no dark theme is switched on), so the variants carry no
// `dark:` classes; add them here, once, if one is ever introduced.
//
// Every size shares the 10px control radius (rounded-glass-sm), the one focus
// ring (focus-ring) and the press scale (press). press-transition (globals.css)
// eases the colours at the hover speed and the scale at the press speed; a
// caller's own transition-* replaces it (cn drops it) and the press then snaps.
const buttonVariants = cva(
  "group/button press press-transition focus-ring inline-flex shrink-0 cursor-pointer items-center justify-center rounded-glass-sm border border-transparent text-sm font-medium whitespace-nowrap outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The one main action of a form, card or dialog (Save, Upload, Confirm).
        // The hover lightens the fill but keeps it opaque, so it never shows the
        // blur of a glass dialog through it.
        default: "bg-deep-violet-blue text-white hover:bg-[color-mix(in_oklab,var(--color-deep-violet-blue),white_14%)]",
        // The alternative beside it (Cancel, Back) and standalone secondary actions.
        outline:
          "border-deep-violet-blue/60 bg-white text-deep-violet-blue hover:border-deep-violet-blue/75 hover:bg-cream aria-expanded:bg-cream",
        // A soft filled action that should not compete with the primary.
        secondary:
          "bg-lavander text-deep-violet-blue hover:bg-[color-mix(in_oklch,var(--color-lavander),var(--color-deep-violet-blue)_8%)] aria-expanded:bg-lavander",
        // Toolbar and table actions that need no outline.
        // A deep-blue tint rather than lavender, so the hover shows on white
        // and on a lavender glass panel alike.
        ghost:
          "text-deep-violet-blue hover:bg-deep-violet-blue/8 aria-expanded:bg-deep-violet-blue/8",
        // The confirming click of a delete or discard, not its trigger.
        destructive:
          "bg-red-700 text-white hover:bg-red-800",
        // The button that opens a delete or discard, before the confirming click.
        "destructive-outline":
          "border-red-300 bg-white text-red-700 hover:bg-red-50",
        // An action that reads as text, inside a table row or a sentence.
        link: "text-deep-violet-blue underline-offset-4 hover:underline",
        // The Scenario builder's own accent, so its main actions match its chips.
        scenario: "bg-scenario text-white hover:bg-scenario-ink",
      },
      // Three heights: sm in tables, filters and toolbars; default in forms and
      // dialogs; lg for a page's main action. xs and the icon sizes are for
      // dense inline controls.
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    // A link takes the height and padding of the text around it, whatever size
    // it is given. Listed after `variants`, so it wins the class merge in cn().
    compoundVariants: [{ variant: "link", className: "h-auto rounded-none p-0" }],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props} />
  );
}

export { Button, buttonVariants }
