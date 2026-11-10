import Image from 'next/image';
import { ShieldCheck } from 'lucide-react';

import { PackshotBackdrop } from '@/components/auth/PackshotBackdrop';
import { buttonVariants } from '@/components/ui/button';
import { glassSurfaceClass } from '@/components/ui/surfaceStyles';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
    <main className="aire-glass-scene relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-4 py-6 sm:px-6 sm:py-12">
      <PackshotBackdrop />
      <Card className={cn(glassSurfaceClass, 'auth-glass-arrive relative z-10 w-full max-w-3xl gap-0 overflow-hidden py-0 sm:min-h-[34rem]')}>
        <CardHeader className="flex flex-1 flex-col items-center justify-center px-6 pt-9 pb-8 text-center sm:px-16 sm:pt-16 sm:pb-10">
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
        <CardContent className="space-y-5 border-t border-card/70 bg-card/40 px-6 py-8 sm:space-y-6 sm:px-16 sm:py-12">
          {errorMessage && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-base text-destructive">
              {errorMessage}
            </p>
          )}
          {!apiBase && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-base text-destructive">
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
                'h-14 w-full gap-3 border-border/70 bg-card/75 px-4 text-base font-semibold shadow-sm backdrop-blur-sm transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-md motion-reduce:transform-none sm:h-16 sm:px-6 sm:text-xl',
            })}
          >
            <Image src="/google-g-logo.svg" alt="" width={24} height={24} />
            Continue with Google
          </a>
          <div className="flex items-start justify-center gap-2 text-center text-xs leading-5 text-muted-foreground sm:items-center sm:text-sm">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary sm:mt-0" />
            <span>Google Workspace SSO · Verified @shop-aire.com accounts only</span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
