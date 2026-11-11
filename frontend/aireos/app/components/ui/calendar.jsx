// shadcn/ui Calendar (generated via `npx shadcn add calendar`, react-day-picker),
// restyled with the AIRE brand tokens so a day grid matches ui/MonthGrid: a
// deep-blue hover tint (it sits on a glass panel), solid deep-violet-blue for a
// picked day or a range's ends, lavender between them, faded days outside the
// month. Focus is the Button's shared focus ring. The shadcn structure and props
// are kept. Pickers are built on it in ui/DatePicker and ui/RangeDatePicker;
// see app/testing for both.
"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { DayPicker, getDefaultClassNames } from "react-day-picker";

import { Button, buttonVariants } from "@/components/ui/button"
import { toYmd } from "@/app/utils/datePicker"
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  locale,
  formatters,
  components,
  ...props
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar bg-white p-2 text-deep-violet-blue [--cell-radius:var(--radius-md)] [--cell-size:--spacing(8)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(locale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("relative flex flex-col gap-4 md:flex-row", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-30",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-30",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          // The select is invisible over its label, so the label's box shows the ring.
          "relative rounded-(--cell-radius) has-focus-visible:outline-solid has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn("absolute inset-0 bg-white opacity-0", defaultClassNames.dropdown),
        caption_label: cn("font-semibold select-none", captionLayout === "label"
          ? "text-sm"
          : "flex h-7 items-center gap-1 rounded-(--cell-radius) px-1.5 text-sm transition-colors duration-hover hover:bg-deep-violet-blue/8 [&>svg]:size-3.5 [&>svg]:text-deep-violet-blue/50", defaultClassNames.caption_label),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 rounded-(--cell-radius) text-[0.8rem] font-normal text-ink-soft select-none",
          defaultClassNames.weekday
        ),
        week: cn("mt-1 flex w-full", defaultClassNames.week),
        week_number_header: cn("w-(--cell-size) select-none", defaultClassNames.week_number_header),
        week_number: cn(
          "text-[0.8rem] text-ink-soft select-none",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)"
            : "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)",
          defaultClassNames.day
        ),
        // The lavender band runs under a range's ends too, so the solid end
        // days join the days between them.
        range_start: cn(
          "relative isolate z-0 rounded-l-(--cell-radius) bg-lavander after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-lavander",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn(
          "relative isolate z-0 rounded-r-(--cell-radius) bg-lavander after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-lavander",
          defaultClassNames.range_end
        ),
        // Today (pass `today={singaporeToday()}`) is bold violet unless picked.
        today: cn(
          "rounded-(--cell-radius) data-[selected=true]:rounded-none [&>button]:font-semibold [&>button]:text-violet",
          defaultClassNames.today
        ),
        outside: cn("[&>button]:text-deep-violet-blue/35", defaultClassNames.outside),
        disabled: cn("opacity-30 [&>button]:cursor-not-allowed", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (<div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />);
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (<ChevronLeftIcon className={cn("size-4", className)} {...props} />);
          }

          if (orientation === "right") {
            return (<ChevronRightIcon className={cn("size-4", className)} {...props} />);
          }

          return (<ChevronDownIcon className={cn("size-4", className)} {...props} />);
        },
        DayButton: ({ ...props }) => (
          <CalendarDayButton locale={locale} {...props} />
        ),
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div
                className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          );
        },
        ...components,
      }}
      {...props} />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      // ISO, not toLocaleDateString: the server and the browser format locale
      // dates differently, which fails hydration on every day button.
      data-day={toYmd(day.date)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 rounded-(--cell-radius) border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10",
        // An inset ring: the next day cell (relative isolate z-10, and a range
        // end sits in its own z-0 stack) would paint over an outset one. It
        // follows the Button's focus-ring in the stylesheet, so it wins.
        "focus-ring-inset",
        "data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-lavander data-[range-middle=true]:text-deep-violet-blue data-[range-middle=true]:hover:bg-lavander",
        "data-[range-start=true]:bg-deep-violet-blue data-[range-start=true]:text-white data-[range-start=true]:hover:bg-deep-violet-blue",
        "data-[range-end=true]:bg-deep-violet-blue data-[range-end=true]:text-white data-[range-end=true]:hover:bg-deep-violet-blue",
        "data-[selected-single=true]:bg-deep-violet-blue data-[selected-single=true]:text-white data-[selected-single=true]:hover:bg-deep-violet-blue",
        "[&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props} />
  );
}

export { Calendar, CalendarDayButton }
