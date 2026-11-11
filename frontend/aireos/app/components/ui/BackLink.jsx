import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Round back-arrow link that sits just left of a page title (see
 * PageLayout's `back` prop), so it adds no height to the header. The arrow
 * alone is the control; the destination is its tooltip and accessible name.
 *
 * @param {{ href: string, label: string, className?: string }} props
 */
export default function BackLink({ href, label, className }) {
  return (
    <Link
      href={href}
      title={`Back to ${label}`}
      aria-label={`Back to ${label}`}
      className={cn(
        'press group inline-flex size-8 shrink-0 items-center justify-center rounded-full text-deep-violet-blue outline-none press-transition hover:bg-lavander focus-ring',
        className,
      )}
    >
      <ArrowLeft
        aria-hidden="true"
        className="size-5 transition-transform group-hover:-translate-x-0.5"
      />
    </Link>
  );
}
