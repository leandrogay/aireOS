import Image from 'next/image';
import { LogIn } from 'lucide-react';

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
    <main className="flex min-h-screen items-center justify-center bg-cream px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Image src="/aire-logo.png" alt="AIRE" width={96} height={39} priority />
          <CardTitle className="mt-4 text-2xl">Sign in to AireOS</CardTitle>
          <CardDescription>
            Continue with your Aire Google Workspace account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </p>
          )}
          {!apiBase && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              NEXT_PUBLIC_API_URL is not configured.
            </p>
          )}
          <a
            href={apiBase ? loginUrl : undefined}
            aria-disabled={!apiBase}
            className={buttonVariants({ size: 'lg', className: 'w-full' })}
          >
            <LogIn />
            Sign in with Enterprise SSO
          </a>
          <p className="text-center text-xs text-muted-foreground">
            Access is limited to verified @shop-aire.com accounts.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
