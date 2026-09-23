'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

// Every tab links to a real (currently placeholder, for Forecast/Promotions/
// Inventory — see app/forecast, app/promotions, app/inventory) page, so
// nothing is blocked off. Mappings is nested under Upload and only appears
// while the user is in the Upload/Mappings flow.
const NAV_ITEMS = [
  {
    label: 'Upload',
    href: '/upload',
    children: [{ label: 'Mappings', href: '/mappings' }],
  },
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Forecast', href: '/forecast' },
  { label: 'Promotions', href: '/promotions' },
  { label: 'Inventory', href: '/inventory' },
];

// A detail route (/mappings/abc123) still belongs to its tab.
function matchesPath(pathname, href) {
  return pathname === href || !!pathname?.startsWith(`${href}/`);
}

// Standardized left nav, shared across every app page via AppShell.
export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav
      className={`shrink-0 sticky top-0 self-start h-screen overflow-y-auto py-4 transition-[width] duration-150 ${
        collapsed ? 'w-12 px-2' : 'w-36 px-3 border-r border-lavander bg-white'
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        className="mb-4 flex w-full items-center justify-center rounded-md py-1.5 text-lg leading-none text-deep-violet-blue hover:bg-lavander"
      >
        ☰
      </button>

      {!collapsed && (
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = matchesPath(pathname, item.href);
            const childActive =
              item.children?.some((child) => matchesPath(pathname, child.href)) ?? false;
            // Show sub-items only while inside this section (parent or any child).
            const showChildren = !!item.children && (isActive || childActive);

            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`block rounded-md py-2 px-3 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-deep-violet-blue text-white'
                      : childActive
                        ? 'text-deep-violet-blue font-semibold hover:bg-lavander'
                        : 'text-deep-violet-blue hover:bg-lavander'
                  }`}
                >
                  {item.label}
                </Link>

                {showChildren && (
                  <ul className="mt-1 ml-3 space-y-0.5 border-l border-violet/60 pl-2">
                    {item.children.map((child) => {
                      const isChildActive = matchesPath(pathname, child.href);
                      return (
                        <li key={child.label}>
                          <Link
                            href={child.href}
                            aria-current={isChildActive ? 'page' : undefined}
                            className={`block rounded-md py-1.5 px-2 text-xs transition-colors ${
                              isChildActive
                                ? 'bg-lavander text-deep-violet-blue font-medium'
                                : 'text-deep-violet-blue/70 hover:bg-lavander hover:text-deep-violet-blue'
                            }`}
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
    </nav>
  );
}