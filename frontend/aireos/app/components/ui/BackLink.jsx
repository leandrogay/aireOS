import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "Back to …" link for a page header, with a leading arrow so it reads as
 * navigation rather than an action. Sized to sit beside `RefreshButton`.
 *
 * @param {{ href: string, className?: string, children: import('react').ReactNode }} props
 */
export default function BackLink({ href, className, children }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-violet bg-white px-3 py-1.5 text-xs font-medium text-deep-violet-blue transition hover:bg-lavander',
        className,
      )}
    >
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      {children}
    </Link>
  );
}
