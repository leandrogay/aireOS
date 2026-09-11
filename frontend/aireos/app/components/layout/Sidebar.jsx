'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

// Every tab links to a real (currently placeholder, for Forecast/Promotions/
// Inventory — see app/forecast, app/promotions, app/inventory) page, so
// nothing is blocked off.
const NAV_ITEMS = [
  { label: 'Upload', href: '/upload' },
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Forecast', href: '/forecast' },
  { label: 'Promotions', href: '/promotions' },
  { label: 'Inventory', href: '/inventory' },
];

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
            const isActive = pathname === item.href;
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className={`block rounded-md py-2 px-3 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-deep-violet-blue text-white'
                      : 'text-deep-violet-blue hover:bg-lavander'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
