import { NextResponse } from 'next/server';

const SESSION_COOKIE = 'aireos_session';

export function proxy(request) {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'true') {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // api/ is excluded: in deployed builds /api/* is forwarded to the backend,
  // which checks the session itself, and /api/auth/* must work signed out.
  matcher: ['/((?!api/|login|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
