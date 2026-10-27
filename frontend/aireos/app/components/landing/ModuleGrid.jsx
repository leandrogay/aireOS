import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { NAV_ITEMS } from '@/components/layout/navItems';

// One card per app section, read from the same list as the sidebar. The whole
// card links to the section; its sub-pages (e.g. Mappings under Upload) are
// listed underneath as their own links, so they sit outside the card link
// rather than nesting one link inside another.
export default function ModuleGrid() {
  return (
    <section aria-labelledby="sections-heading">
      <h2 id="sections-heading" className="font-serif text-2xl text-deep-violet-blue">
        Everything in one place
      </h2>
      <p className="mt-1 text-sm text-deep-violet-blue/70">
        Each section reads the same uploaded data, so the numbers agree from page to page.
      </p>

      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li
              key={item.href}
              className="flex flex-col rounded-lg border border-lavander bg-white shadow-sm transition-colors focus-within:border-violet hover:border-violet sm:last:col-span-2 lg:last:col-span-1"
            >
              <Link
                href={item.href}
                className="group flex flex-1 flex-col gap-2 rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
              >
                <span className="flex size-9 items-center justify-center rounded-md bg-lavander text-deep-violet-blue">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="flex items-center gap-1 text-sm font-medium text-deep-violet-blue">
                  {item.label}
                  <ArrowRight
                    className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    aria-hidden="true"
                  />
                </span>
                <span className="text-sm text-deep-violet-blue/70">{item.description}</span>
              </Link>

              {item.children && (
                <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-lavander px-4 py-2.5">
                  {item.children.map((child) => (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        className="rounded text-xs text-deep-violet-blue/70 underline-offset-4 hover:text-deep-violet-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                      >
                        {child.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
