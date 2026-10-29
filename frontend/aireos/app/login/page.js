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
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-cream px-6 py-12">
      <PackshotBackdrop />
      <Card className="relative z-10 min-h-[34rem] w-full max-w-3xl gap-0 overflow-hidden border-border/70 py-0 shadow-xl shadow-primary/10">
        <CardHeader className="flex flex-1 flex-col items-center justify-center px-8 pt-12 pb-10 text-center sm:px-16 sm:pt-16">
          <Image
            src="/aire-logo.png"
            alt="AIRE"
            width={150}
            height={61}
            className="mx-auto"
            priority
          />
          <CardTitle className="mt-9 text-4xl tracking-tight text-deep-violet-blue sm:text-5xl">
            Welcome to AireOS
          </CardTitle>
          <CardDescription className="mt-3 max-w-lg text-lg leading-8 text-balance">
            Sign in securely with your Aire Google Workspace account to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 border-t border-border/60 bg-card/60 px-8 py-10 sm:px-16 sm:py-12">
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
                'h-16 w-full gap-3 border-border bg-background px-6 text-xl font-semibold shadow-sm hover:border-primary/40 hover:bg-primary/5',
            })}
          >
            <Image src="/google-g-logo.svg" alt="" width={24} height={24} />
            Continue with Google
          </a>
          <div className="flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
            <span>Google Workspace SSO · Verified @shop-aire.com accounts only</span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
