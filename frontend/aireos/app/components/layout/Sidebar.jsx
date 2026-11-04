'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut, PanelLeft } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';

import { NAV_ITEMS, matchesPath } from '@/components/layout/navItems';
import RailFlyout from '@/components/layout/RailFlyout';
import { logout } from '@/app/services/authApi';
import useMediaQuery from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

// Every row and the active highlight move on this one spring, so when a
// sub-list opens or closes the highlight lands with the rows, not ahead of them.
const LAYOUT_SPRING = { type: 'spring', stiffness: 500, damping: 40 };

// The nav bar's widths in px, animated by Motion: open (14rem), the icon rail
// (3.5rem: px-2 either side of a 2.5rem tab, so a tab's icon sits centred) and
// hidden (3rem, just the toggle, narrow screens only).
const OPEN_WIDTH = 224;
const RAIL_WIDTH = 56;
const HIDDEN_WIDTH = 48;
const NAV_SPRING = { type: 'spring', stiffness: 400, damping: 40 };

// Every page mounts its own Sidebar (PageLayout → AppShell), so whether the
// bar is collapsed is kept here, at module level, to survive the page change:
// clicking a rail tab keeps the rail. Only the toggle opens or closes it.
let lastCollapsed = false;

// Below Tailwind's md breakpoint a collapsed bar hides instead of becoming a rail.
const NARROW_QUERY = '(max-width: 767px)';

// A tab label fades out as the bar closes to the rail, and back in once it
// has mostly opened. CSS rather than Motion, so labels don't fade in on every
// page load.
// min-w-0 + overflow-hidden: in the rail's icon-wide tab the label shrinks to
// nothing rather than spilling past the tab.
const LABEL_FADE = 'min-w-0 overflow-hidden whitespace-nowrap transition-opacity';

// The logo and tabs fade out fast as the bar closes, and fade in once it has
// mostly opened, so labels never show squeezed into a half-open bar.
const NAV_CONTENT = {
  hidden: { opacity: 0, transition: { duration: 0.1 } },
  shown: { opacity: 1, transition: { duration: 0.2, delay: 0.1 } },
};

// A sub-list draws its guide line down, then fades its labels in one by one.
// Closing is quick: the rows below are already sliding up over it.
const SUB_LIST = {
  hidden: { transition: { duration: 0.1 } },
  shown: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
const SUB_LINE = {
  hidden: { scaleY: 0, transition: { duration: 0.1 } },
  shown: { scaleY: 1, transition: { duration: 0.4, ease: 'easeOut' } },
};
const SUB_LABEL = {
  hidden: { opacity: 0, x: -6, transition: { duration: 0.1 } },
  shown: { opacity: 1, x: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

// The active-tab background. One layoutId for parents and sub-items alike,
// so it slides (and resizes) between the two levels instead of popping.
function ActiveHighlight() {
  return (
    <motion.span
      layoutId="nav-active"
      className="absolute inset-0 -z-10 rounded-lg bg-lavander"
    />
  );
}

// The classes for a tab label: hidden in the rail, shown (after a short
// delay, so it isn't squeezed into a half-open bar) otherwise.
function labelClass(rail) {
  return cn(LABEL_FADE, rail ? 'opacity-0 duration-100' : 'opacity-100 delay-100 duration-200');
}

// Standardized left nav, shared across every app page via AppShell.
// Open: logo + icon tabs. Collapsed: a rail of icon-only tabs; on narrow
// screens only the toggle is left, so the page gets the full width.
export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(() => lastCollapsed);
  const narrow = useMediaQuery(NARROW_QUERY);
  const rail = collapsed && !narrow;
  const hidden = collapsed && narrow;
  const width = hidden ? HIDDEN_WIDTH : rail ? RAIL_WIDTH : OPEN_WIDTH;
  // The label of the rail section whose flyout is open; one at a time.
  const [openFlyout, setOpenFlyout] = useState(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true';
  // Width isn't covered by MotionConfig's reducedMotion, so snap it here.
  const reduceMotion = useReducedMotion();

  // The nav bar's width as --sidebar-width, so the assistant's full-screen
  // panel can sit flush against it (AssistantWidget). Set to the width the bar
  // mounts at; onUpdate below keeps the variable in step while the width
  // animates. Removed when a page without the nav bar is shown.
  const [mountWidth] = useState(width);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--sidebar-width', `${mountWidth}px`);
    return () => root.style.removeProperty('--sidebar-width');
  }, [mountWidth]);

  const toggleCollapsed = () => {
    lastCollapsed = !collapsed;
    setCollapsed(!collapsed);
  };

  const handleLogout = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    setLogoutError('');
    try {
      await logout();
      router.replace('/login');
      router.refresh();
    } catch (error) {
      setLogoutError(error.message || 'Unable to sign out. Please try again.');
      setIsSigningOut(false);
    }
  };

  return (
    <motion.nav
      initial={false}
      animate={{ width }}
      transition={reduceMotion ? { duration: 0 } : NAV_SPRING}
      onUpdate={(latest) => {
        document.documentElement.style.setProperty('--sidebar-width', `${latest.width}px`);
      }}
      className={cn(
        // Border and background stay on CSS transitions; they fade alongside the width.
        'sticky top-0 flex h-screen shrink-0 flex-col self-start overflow-x-hidden overflow-y-auto border-r py-4 transition-colors duration-300',
        collapsed ? 'px-2' : 'px-3',
        hidden ? 'border-transparent bg-transparent' : 'border-lavander bg-white',
      )}
    >
      <div className="relative mb-4 flex h-8 items-center">
        {/* Absolute, so the logo coming and going never pushes the toggle
            around; it just fades over the row. */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="logo"
              variants={NAV_CONTENT}
              initial="hidden"
              animate="shown"
              exit="hidden"
              className="absolute top-1/2 left-1 -translate-y-1/2"
            >
              <Link href="/dashboard" aria-label="AIRE home">
                <Image
                  src="/aire-logo.png"
                  alt="AIRE"
                  width={72}
                  height={30}
                  className="h-auto w-auto"
                  priority
                />
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
        {/* ml-auto rides the toggle on the bar's right edge as it resizes. It
            stays 12px in from that edge open and in the rail (px-3 vs px-2 +
            mr-1), so it never jumps between them, and in the rail that centres
            it over the icons. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className={cn(
            'ml-auto flex size-8 cursor-pointer items-center justify-center rounded-md text-deep-violet-blue/70 transition-colors hover:bg-lavander hover:text-deep-violet-blue',
            rail && 'mr-1',
          )}
        >
          <PanelLeft className="size-4" />
        </button>
      </div>

      {/* reducedMotion="user": slides and the line draw become instant for
          users who ask for less motion; fades still run. */}
      <MotionConfig transition={LAYOUT_SPRING} reducedMotion="user">
        <AnimatePresence initial={false}>
          {/* Fixed width (the open bar's content width), so the labels don't
              wrap while the bar narrows around them. */}
          {!hidden && (
            <motion.ul
              key="tabs"
              variants={NAV_CONTENT}
              initial="hidden"
              animate="shown"
              exit="hidden"
              className="w-50 shrink-0 space-y-0.5"
            >
              {NAV_ITEMS.map((item) => {
                const childActive =
                  item.children?.some((child) => matchesPath(pathname, child.href)) ?? false;
                // Catalog shares its href with its first child; highlight the child only.
                const isActive = matchesPath(pathname, item.href) && !childActive;
                // Show sub-items only while inside this section (parent or any child),
                // and never in the rail, where the parent icon stands in for them.
                const showChildren = !!item.children && (isActive || childActive) && !rail;
                const isHighlighted = isActive || (rail && childActive);
                const Icon = item.icon;
                // In the rail the tab shrinks to its icon (the label stays in the
                // DOM, invisible, as the tab's accessible name). No overflow-hidden
                // here: it would clip the highlight while it slides in from another
                // tab, so the label clips itself instead (labelClass).
                const tabClass = cn(
                  'relative isolate flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-deep-violet-blue transition-[width] duration-300',
                  rail ? 'w-10' : 'w-full',
                  (isActive || childActive) && 'font-medium',
                );
                const tabContent = (
                  <>
                    {isHighlighted && <ActiveHighlight />}
                    <Icon className="size-4 shrink-0" />
                    <span className={labelClass(rail)}>{item.label}</span>
                  </>
                );

                return (
                  // layout="position": when a sub-list above opens or closes, this
                  // row slides to its new place instead of jumping.
                  <motion.li key={item.label} layout="position" className="relative">
                    {/* A section with sub-pages can't list them in the rail, so
                        it shows them in a flyout (RailFlyout decides whether the
                        icon also links to the section's own page). */}
                    {rail && item.children ? (
                      <RailFlyout
                        item={item}
                        pathname={pathname}
                        isActive={isActive}
                        open={openFlyout === item.label}
                        onOpenChange={(open) => {
                          // Only close it if it is still the open one: hovering onto
                          // another section opens that one first.
                          if (open) setOpenFlyout(item.label);
                          else setOpenFlyout((current) => (current === item.label ? null : current));
                        }}
                        className={tabClass}
                      >
                        {tabContent}
                      </RailFlyout>
                    ) : (
                      <Link
                        href={item.href}
                        aria-current={isActive ? 'page' : undefined}
                        title={rail ? item.label : undefined}
                        className={tabClass}
                      >
                        {tabContent}
                      </Link>
                    )}

                    {/* popLayout takes a closing sub-list out of the flow at once,
                        so the rows and the highlight all aim at their final places
                        while it fades out. */}
                    <AnimatePresence initial={false} mode="popLayout">
                      {showChildren && (
                        <motion.ul
                          key="children"
                          layout="position"
                          variants={SUB_LIST}
                          initial="hidden"
                          animate="shown"
                          exit="hidden"
                          className="relative mt-0.5 ml-5 space-y-0.5 pl-2"
                        >
                          <motion.span
                            aria-hidden
                            variants={SUB_LINE}
                            className="absolute inset-y-0 left-0 w-px origin-top bg-violet/60"
                          />
                          {item.children.map((child) => {
                            const isChildActive = matchesPath(pathname, child.href);
                            return (
                              <li key={child.label}>
                                <Link
                                  href={child.href}
                                  aria-current={isChildActive ? 'page' : undefined}
                                  className={cn(
                                    'relative isolate block rounded-lg px-3 py-1.5 text-xs',
                                    isChildActive
                                      ? 'font-medium text-deep-violet-blue'
                                      : 'text-deep-violet-blue/70',
                                  )}
                                >
                                  {isChildActive && <ActiveHighlight />}
                                  {/* Only the label fades in, so a highlight sliding
                                      into this row stays fully opaque. */}
                                  <motion.span variants={SUB_LABEL} className="block">
                                    {child.label}
                                  </motion.span>
                                </Link>
                              </li>
                            );
                          })}
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </MotionConfig>

      <AnimatePresence initial={false}>
        {authEnabled && !hidden && (
          <motion.div
            key="sign-out"
            variants={NAV_CONTENT}
            initial="hidden"
            animate="shown"
            exit="hidden"
            className="mt-auto w-50 shrink-0 pt-4"
          >
            <button
              type="button"
              onClick={handleLogout}
              disabled={isSigningOut}
              title={rail ? 'Sign out' : undefined}
              className={cn(
                'flex cursor-pointer items-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-sm text-deep-violet-blue/75 transition-[width,background-color,color] duration-300 hover:bg-lavander hover:text-deep-violet-blue disabled:cursor-wait disabled:opacity-60',
                rail ? 'w-10' : 'w-full',
              )}
            >
              <LogOut className="size-4 shrink-0" />
              <span className={labelClass(rail)}>
                {isSigningOut ? 'Signing out...' : 'Sign out'}
              </span>
            </button>
            {logoutError && !rail && (
              <p className="mt-1 px-3 text-xs text-red-700" role="alert">
                {logoutError}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
