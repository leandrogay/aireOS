import Image from 'next/image';
import { ShieldCheck } from 'lucide-react';

import { PackshotBackdrop } from '@/components/auth/PackshotBackdrop';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const ERROR_MESSAGES = {
  access_denied: 'Google sign-in was cancelled.',
  authentication_failed: 'Google could not complete the sign-in. Please try again.',
  invalid_response: 'Google returned an incomplete sign-in response. Please try again.',
  invalid_state: 'The sign-in request expired or could not be verified. Please try again.',
  unauthorized_domain: 'Use an authorised @shop-aire.com Google Workspace account.',
};

function safeNextPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/dashboard';
  }
  return value;
}

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
  const nextPath = safeNextPath(params?.next);
  const loginUrl = `${apiBase}/api/auth/login?next=${encodeURIComponent(nextPath)}`;
  const errorMessage = ERROR_MESSAGES[params?.error];

  return (
    // Its own cream ground, under the packshot backdrop, covers the app's page
    // wash (aire-wash on <body>), so the two never show at once.
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-cream px-4 py-6 sm:px-6 sm:py-12">
      <PackshotBackdrop />
      {/* The showcase glass: glass-2 (text-heavy, so no thinner) frosting the
          packshots as they drift behind it, with the dialogs' larger lift. The
          Card is an aire-card, which the later glass rules replace (globals.css). */}
      <Card className="glass-2 relative z-10 w-full max-w-3xl gap-0 overflow-hidden rounded-glass-lg py-0 shadow-glass-3 sm:min-h-[34rem]">
        {/* The same white/50 underlay as the content below, so the whole card
            reads as one surface and the ink-soft description keeps 5.2:1 even
            over a dark packshot (4.3:1 on the bare glass). */}
        <CardHeader className="flex flex-1 flex-col items-center justify-center bg-white/50 px-6 pt-9 pb-8 text-center sm:px-16 sm:pt-16 sm:pb-10">
          <Image
            src="/aire-logo.png"
            alt="AIRE"
            width={150}
            height={61}
            className="mx-auto h-auto w-28 sm:w-[150px]"
            priority
          />
          <CardTitle className="mt-6 text-3xl leading-tight tracking-tight text-deep-violet-blue sm:mt-9 sm:text-5xl">
            Welcome to AireOS
          </CardTitle>
          <CardDescription className="mt-3 max-w-lg text-base leading-6 text-balance sm:text-lg sm:leading-8">
            Sign in securely with your Aire Google Workspace account to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 border-t border-(--glass-border) bg-white/50 px-6 py-8 sm:space-y-6 sm:px-16 sm:py-12">
          {/* Solid red-50 with red-800 text (about 8:1), so the reason is
              readable whatever drifts behind the glass. */}
          {errorMessage && (
            <p role="alert" className="rounded-glass-sm border border-red-200 bg-red-50 px-4 py-3 text-base text-red-800">
              {errorMessage}
            </p>
          )}
          {!apiBase && (
            <p role="alert" className="rounded-glass-sm border border-red-200 bg-red-50 px-4 py-3 text-base text-red-800">
              NEXT_PUBLIC_API_URL is not configured.
            </p>
          )}
          <a
            href={apiBase ? loginUrl : undefined}
            aria-disabled={!apiBase}
            className={buttonVariants({
              variant: 'outline',
              size: 'lg',
              className:
                // The outline Button (press, focus-ring, the 3:1 deep-blue edge),
                // solid white so the one action stands off the glass.
                'h-14 w-full gap-3 rounded-glass-md bg-white px-4 text-base font-semibold shadow-sm hover:bg-cream sm:h-16 sm:px-6 sm:text-xl',
            })}
          >
            <Image src="/google-g-logo.svg" alt="" width={24} height={24} />
            Continue with Google
          </a>
          <div className="flex items-start justify-center gap-2 text-center text-xs leading-5 text-ink-soft sm:items-center sm:text-sm">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-deep-violet-blue sm:mt-0" />
            <span>Google Workspace SSO · Verified @shop-aire.com accounts only</span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
