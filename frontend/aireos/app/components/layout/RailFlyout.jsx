'use client';

import Link from 'next/link';

import { matchesPath } from '@/components/layout/navItems';
import { DROPDOWN_ROW_CLASS } from '@/components/ui/Dropdown';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Opens this soon after the pointer settles, so sweeping down the rail
// doesn't flash every flyout open.
const HOVER_DELAY = 150;

// Whether a section has a page of its own (Upload, Inventory) rather than
// just grouping its children (Catalog, whose href is its first child's).
function hasOwnPage(item) {
  return !item.children.some((child) => child.href === item.href);
}

// The flyout is a glass popover (ui/popover), so its rows are the dropdown
// panels' rows (ui/Dropdown DROPDOWN_ROW_CLASS: 10px inside the panel's 16px
// corner, deep-blue hover tint, inset focus ring). The section row heads the
// list with its icon. The current page carries the sidebar's own state cue
// (Sidebar ActiveHighlight): the 3px deep-blue bar down its left edge, on a
// tint that holds under hover and focus instead of turning lighter.
const SECTION_ROW = 'flex items-center gap-3 px-2 py-1.5 text-sm font-medium text-deep-violet-blue';
const CURRENT_ROW =
  'relative bg-deep-violet-blue/10 font-medium hover:bg-deep-violet-blue/10 focus-visible:bg-deep-violet-blue/10 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-deep-violet-blue';

/**
 * A rail tab for a section with sub-pages (see Sidebar). The rail has no room
 * to list them, so they open in a flyout beside the rail; picking one
 * navigates and the rail stays collapsed. Controlled by the Sidebar, so
 * opening one section's flyout closes any other.
 *
 * A section with its own page (Upload, Inventory) stays a link: a click goes
 * to that page, and the flyout only opens on hover or Right arrow -- one
 * control never both navigates and opens a menu. A section that only groups
 * pages (Catalog) is a button that opens the flyout on click or hover.
 * @param {{ item: { label: string, href: string, icon: React.ComponentType, children: { label: string, href: string }[] },
 *   pathname: string, isActive: boolean, open: boolean, onOpenChange: (open: boolean) => void,
 *   className: string, children: React.ReactNode }} props
 */
export default function RailFlyout({
  item,
  pathname,
  isActive,
  open,
  onOpenChange,
  className,
  children,
}) {
  const isLink = hasOwnPage(item);
  const Icon = item.icon;

  const handleOpenChange = (nextOpen, details) => {
    // A press on a link section is its navigation, not a flyout toggle.
    if (isLink && details.reason === 'trigger-press') return;
    onOpenChange(nextOpen);
  };

  // Right arrow opens the flyout from the keyboard. It doesn't open on focus
  // alone, so tabbing down the rail never stops in every flyout (W3C fly-out
  // menu guidance).
  const handleKeyDown = (event) => {
    if (event.key !== 'ArrowRight') return;
    event.preventDefault();
    onOpenChange(true);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        openOnHover
        delay={HOVER_DELAY}
        aria-label={item.label}
        onKeyDown={handleKeyDown}
        className={className}
        {...(isLink && {
          nativeButton: false,
          render: <Link href={item.href} aria-current={isActive ? 'page' : undefined} />,
        })}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-52 gap-0.5 p-1.5"
      >
        {/* Laid out like the open sidebar's section (Sidebar): the section's
            row with its icon, then its sub-pages indented on a guide line. A
            section without a page of its own (Catalog) heads the list as a
            plain label instead of a link. */}
        {isLink ? (
          <Link
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(DROPDOWN_ROW_CLASS, SECTION_ROW, isActive && CURRENT_ROW)}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        ) : (
          <p className={SECTION_ROW}>
            <Icon className="size-4 shrink-0" />
            {item.label}
          </p>
        )}
        <ul className="relative ml-5 space-y-0.5 pl-2">
          <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-deep-violet-blue/20" />
          {item.children.map((child) => {
            const isChildActive = matchesPath(pathname, child.href);
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  aria-current={isChildActive ? 'page' : undefined}
                  className={cn(
                    DROPDOWN_ROW_CLASS,
                    'text-xs',
                    isChildActive ? CURRENT_ROW : 'text-ink-soft hover:text-deep-violet-blue',
                  )}
                >
                  {child.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
