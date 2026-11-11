'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const THEME_KEY = 'aireos-theme';

/** The only app state introduced by the visual revamp: a saved theme choice. */
export default function ThemeToggle({ compact = false, className }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setDark(document.documentElement.classList.contains('dark')));
  }, []);

  const changeTheme = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    setDark(next);
    try {
      window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      // The current page still changes theme when storage is unavailable.
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={changeTheme}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      title={compact ? (dark ? 'Light mode' : 'Dark mode') : undefined}
      className={cn('aire-theme-toggle justify-start gap-3 text-deep-violet-blue/75', compact ? 'size-10 px-3' : 'w-full px-3', className)}
    >
      {dark ? <Sun aria-hidden="true" className="size-4 shrink-0" /> : <Moon aria-hidden="true" className="size-4 shrink-0" />}
      {!compact && <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
    </Button>
  );
}
