'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut, PanelLeft } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';

import { NAV_ITEMS } from '@/components/layout/navItems';
import { logout } from '@/app/services/authApi';
import { cn } from '@/lib/utils';

// Every row and the active highlight move on this one spring, so when a
// sub-list opens or closes the highlight lands with the rows, not ahead of them.
const LAYOUT_SPRING = { type: 'spring', stiffness: 500, damping: 40 };

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

// A detail route (/mappings/abc123) still belongs to its tab.
function matchesPath(pathname, href) {
  return pathname === href || !!pathname?.startsWith(`${href}/`);
}

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

// Standardized left nav, shared across every app page via AppShell.
// Open: logo + icon tabs. Closed: only the toggle is left, so the page gets
// the full width.
export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true';

  // The nav bar's width (w-12 / w-56 below) as --sidebar-width, so the
  // assistant's full-screen panel can sit flush against it (AssistantWidget).
  // Removed when a page without the nav bar is shown.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--sidebar-width', collapsed ? '3rem' : '14rem');
    return () => root.style.removeProperty('--sidebar-width');
  }, [collapsed]);

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
    <nav
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col self-start overflow-y-auto py-4 transition-[width] duration-150',
        collapsed ? 'w-12 px-2' : 'w-56 px-3 border-r border-lavander bg-white',
      )}
    >
      <div
        className={cn(
          'mb-4 flex items-center',
          collapsed ? 'flex-col justify-center gap-2' : 'justify-between pl-1',
        )}
      >
        {!collapsed && (
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
        )}
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="flex size-8 items-center justify-center rounded-md text-deep-violet-blue/70 transition-colors hover:bg-lavander hover:text-deep-violet-blue"
        >
          <PanelLeft className="size-4" />
        </button>
      </div>

      {/* reducedMotion="user": slides and the line draw become instant for
          users who ask for less motion; fades still run. */}
      {!collapsed && (
        <MotionConfig transition={LAYOUT_SPRING} reducedMotion="user">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const childActive =
                item.children?.some((child) => matchesPath(pathname, child.href)) ?? false;
              // Catalog shares its href with its first child; highlight the child only.
              const isActive = matchesPath(pathname, item.href) && !childActive;
              // Show sub-items only while inside this section (parent or any child).
              const showChildren = !!item.children && (isActive || childActive);
              const Icon = item.icon;

              return (
                // layout="position": when a sub-list above opens or closes, this
                // row slides to its new place instead of jumping.
                <motion.li key={item.label} layout="position" className="relative">
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'relative isolate flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-deep-violet-blue',
                      (isActive || childActive) && 'font-medium',
                    )}
                  >
                    {isActive && <ActiveHighlight />}
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>

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
          </ul>
        </MotionConfig>
      )}

      {authEnabled && (
        <div className="mt-auto pt-4">
          <button
            type="button"
            onClick={handleLogout}
            disabled={isSigningOut}
            title={collapsed ? 'Sign out' : undefined}
            className={cn(
              'flex w-full items-center rounded-lg py-2 text-sm text-deep-violet-blue/75 transition-colors hover:bg-lavander hover:text-deep-violet-blue disabled:cursor-wait disabled:opacity-60',
              collapsed ? 'justify-center px-2' : 'gap-3 px-3',
            )}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && (isSigningOut ? 'Signing out...' : 'Sign out')}
          </button>
          {!collapsed && logoutError && (
            <p className="mt-1 px-3 text-xs text-red-700" role="alert">
              {logoutError}
            </p>
          )}
        </div>
      )}
    </nav>
  );
}
