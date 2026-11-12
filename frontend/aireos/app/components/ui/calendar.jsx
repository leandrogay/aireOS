// shadcn/ui Calendar (generated via `npx shadcn add calendar`, react-day-picker),
// restyled with the AIRE brand tokens so a day grid matches ui/MonthGrid: cream
// hover, solid deep-violet-blue for a picked day or a range's ends, lavender
// between them, faded days outside the month. The shadcn structure and props
// are kept. Pickers are built on it in ui/DatePicker and ui/RangeDatePicker;
// see app/testing for both.
"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { DayPicker, getDefaultClassNames } from "react-day-picker";

import { Button, buttonVariants } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
          "size-(--cell-size) p-0 select-none hover:bg-cream aria-disabled:opacity-30",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none hover:bg-cream aria-disabled:opacity-30",
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
          "relative rounded-(--cell-radius) has-focus-visible:ring-2 has-focus-visible:ring-violet",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn("absolute inset-0 bg-white opacity-0", defaultClassNames.dropdown),
        caption_label: cn("font-semibold select-none", captionLayout === "label"
          ? "text-sm"
          : "flex h-7 items-center gap-1 rounded-(--cell-radius) px-1.5 text-sm hover:bg-cream [&>svg]:size-3.5 [&>svg]:text-deep-violet-blue/50", defaultClassNames.caption_label),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 rounded-(--cell-radius) text-[0.8rem] font-normal text-deep-violet-blue/50 select-none",
          defaultClassNames.weekday
        ),
        week: cn("mt-1 flex w-full", defaultClassNames.week),
        week_number_header: cn("w-(--cell-size) select-none", defaultClassNames.week_number_header),
        week_number: cn(
          "text-[0.8rem] text-deep-violet-blue/50 select-none",
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
        Dropdown: CalendarDropdown,
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

// The month / year pickers of captionLayout="dropdown". The closed button
// keeps the calendar's own caption look, but the list opens in a panel styled
// like ui/Dropdown's instead of the browser's native <select> list.
// react-day-picker hands over numeric option values and reads the pick back
// as `event.target.value`.
function CalendarDropdown({ options = [], value, onChange, disabled, "aria-label": ariaLabel }) {
  const [open, setOpen] = React.useState(false)
  const current = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={ariaLabel}
        // `relative` lifts it above the nav row, which is absolute across the
        // whole caption and would otherwise take the click.
        className="relative flex h-7 cursor-pointer items-center gap-1 rounded-(--cell-radius) px-1.5 text-sm font-semibold text-deep-violet-blue outline-none select-none hover:bg-cream aria-expanded:bg-cream focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-60"
      >
        {current?.label}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn("size-3.5 text-deep-violet-blue/50 transition-transform", open && "rotate-180")}
        />
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="aire-glass-dropdown-panel w-max min-w-(--anchor-width) gap-0 overflow-hidden rounded-md border border-lavander bg-white p-0 text-deep-violet-blue ring-0"
      >
        <div role="listbox" aria-label={ariaLabel} className="max-h-60 overflow-y-auto overflow-x-hidden p-1.5">
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                // Opens scrolled to the current month / year, not the top.
                ref={selected ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                onClick={() => {
                  setOpen(false)
                  if (!selected) onChange?.({ target: { value: String(option.value) } })
                }}
                className={cn(
                  "flex w-full items-center rounded-md px-2 py-1 text-left text-sm text-deep-violet-blue outline-none hover:bg-cream focus-visible:bg-cream disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                  selected && "bg-lavander/60 font-medium hover:bg-lavander/60"
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
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
        "relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 rounded-(--cell-radius) border-0 leading-none font-normal hover:bg-cream group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-violet group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-violet/40",
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
