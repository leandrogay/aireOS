import { redirect } from 'next/navigation';

// With SSO on, proxy.js sends signed-out visitors to /login before this page
// renders, so the only people who reach / are signed in and go straight to the app.
export default function Home() {
  redirect('/dashboard');
}
