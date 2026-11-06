'use client';

import Link from 'next/link';

import { matchesPath } from '@/components/layout/navItems';
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

// The flyout's section row, sized like a top-level tab in the open sidebar.
const SECTION_ROW =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-deep-violet-blue';

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
        className="w-52 gap-0.5 bg-white p-1.5"
      >
        {/* Laid out like the open sidebar's section (Sidebar): the section's
            row with its icon, then its sub-pages indented on a guide line. A
            section without a page of its own (Catalog) heads the list as a
            plain label instead of a link. */}
        {isLink ? (
          <Link
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(SECTION_ROW, 'transition-colors hover:bg-lavander', isActive && 'bg-lavander')}
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
          <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-violet/60" />
          {item.children.map((child) => {
            const isChildActive = matchesPath(pathname, child.href);
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  aria-current={isChildActive ? 'page' : undefined}
                  className={cn(
                    'block rounded-lg px-3 py-1.5 text-xs transition-colors hover:bg-lavander',
                    isChildActive
                      ? 'bg-lavander font-medium text-deep-violet-blue'
                      : 'text-deep-violet-blue/70 hover:text-deep-violet-blue',
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
