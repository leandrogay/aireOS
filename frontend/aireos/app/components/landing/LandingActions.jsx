import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Same navy primary the app uses for its main actions (e.g. Create promotion).
const PRIMARY_CLASS = 'bg-deep-violet-blue text-white hover:bg-deep-violet-blue/90';

/**
 * Every call to action on the landing page, in one place, so sign-in can be
 * added by changing only this file.
 *
 * There is no login yet, so everyone gets "Open dashboard". When sign-in
 * exists, page.js reads the session and passes `signedIn`:
 *   - signed out: the primary action becomes "Sign in" (→ /login) and the
 *     secondary one is hidden, since every other page will need a session
 *   - signed in: keep these links, or redirect / straight to /dashboard
 *
 */
export default function LandingActions() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href="/dashboard"
        className={cn(buttonVariants({ size: 'lg' }), PRIMARY_CLASS, 'px-4')}
      >
        Open dashboard
        <ArrowRight data-icon="inline-end" />
      </Link>
      <Link
        href="/upload"
        className={cn(
          buttonVariants({ variant: 'outline', size: 'lg' }),
          'border-violet/60 bg-white px-4 text-deep-violet-blue hover:bg-lavander',
        )}
      >
        Upload sales data
      </Link>
    </div>
  );
}
