'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  Library,
  LogOut,
  Package,
  PanelLeft,
  Tag,
  TrendingUp,
  Upload,
} from 'lucide-react';

import { logout } from '@/app/services/authApi';
import { cn } from '@/lib/utils';


// Every tab links to a real (currently placeholder, for Forecast/Promotions/
// Inventory — see app/forecast, app/promotions, app/inventory) page, so
// nothing is blocked off. Sub-items (Mappings under Upload, SKUs/Customers
// under Catalog) only appear while the user is inside that section. Catalog has
// no page of its own, so it links to its first child.
const NAV_ITEMS = [
  {
    label: 'Upload',
    href: '/upload',
    icon: Upload,
    children: [
      { label: 'Mappings', href: '/mappings' },
    ],
  },
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Forecast', href: '/forecast', icon: TrendingUp },
  { label: 'Promotions', href: '/promotions', icon: Tag },
  {
    label: 'Inventory',
    href: '/inventory',
    icon: Package,
    children: [{ label: 'DOH settings', href: '/doh' }],
  },
  {
    label: 'Catalog',
    href: '/skus',
    icon: Library,
    children: [
      { label: 'SKUs', href: '/skus' },
      { label: 'Customers', href: '/customers' },
    ],
  },
];

// A detail route (/mappings/abc123) still belongs to its tab.
function matchesPath(pathname, href) {
  return pathname === href || !!pathname?.startsWith(`${href}/`);
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
              height={29}
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

      {!collapsed && (
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
              <li key={item.label}>
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-deep-violet-blue transition-colors hover:bg-lavander',
                    isActive && 'bg-lavander font-medium',
                    childActive && 'font-medium',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </Link>

                {showChildren && (
                  <ul className="mt-0.5 ml-5 space-y-0.5 border-l border-violet/60 pl-2">
                    {item.children.map((child) => {
                      const isChildActive = matchesPath(pathname, child.href);
                      return (
                        <li key={child.label}>
                          <Link
                            href={child.href}
                            aria-current={isChildActive ? 'page' : undefined}
                            className={cn(
                              'block rounded-lg px-3 py-1.5 text-xs transition-colors',
                              isChildActive
                                ? 'bg-lavander font-medium text-deep-violet-blue'
                                : 'text-deep-violet-blue/70 hover:bg-lavander hover:text-deep-violet-blue',
                            )}
                          >
                            {child.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
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
