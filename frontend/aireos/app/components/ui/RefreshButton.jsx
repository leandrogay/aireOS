'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { REFRESH_SPIN } from '@/app/config/transitions';
import { spinRemainingMs } from '@/app/utils/refreshSpin';

// One turn every REFRESH_SPIN.turn seconds (0.7s), a little quicker than
// Tailwind's 1s animate-spin. Written out whole so Tailwind finds it; change
// both together.
const SPIN_CLASS = 'animate-[spin_0.7s_linear_infinite]';

/**
 * Icon-only refresh button that spins while a reload is in flight.
 *
 * Pass the page's own loading flag as `isRefreshing`: the arrow spins
 * while it is true, so no extra state is needed at the call site. A click
 * spins it at once, before the page's flag catches up, and it always
 * finishes whole turns (REFRESH_SPIN, at least one), so a reload that
 * answers in a few milliseconds still shows it happened instead of looking
 * like a dead button. The button is disabled while spinning so a
 * double-click cannot queue a second reload.
 *
 * Any `Button` prop (`variant`, `size`, `className`, …) passes through,
 * so a page can match it to its neighbouring controls.
 *
 * @param {{
 *   onClick: () => void,
 *   isRefreshing?: boolean,
 *   label?: string,
 *   busyLabel?: string,
 *   variant?: string,
 *   size?: string,
 *   className?: string,
 * }} props
 */
export default function RefreshButton({
  onClick,
  isRefreshing = false,
  label = 'Refresh',
  busyLabel = 'Refreshing…',
  variant = 'outline',
  size = 'icon',
  className,
  ...props
}) {
  // When a click started the spin (performance.now()), until it has run its
  // turns and the reload is done; null otherwise.
  const [clickedAt, setClickedAt] = useState(null);
  const spinning = isRefreshing || clickedAt !== null;
  const title = spinning ? busyLabel : label;

  useEffect(() => {
    if (clickedAt === null || isRefreshing) return undefined;
    const timer = setTimeout(
      () => setClickedAt(null),
      spinRemainingMs(clickedAt, performance.now(), REFRESH_SPIN),
    );
    return () => clearTimeout(timer);
  }, [clickedAt, isRefreshing]);

  function handleClick(event) {
    setClickedAt(performance.now());
    onClick(event);
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={spinning}
      aria-label={title}
      aria-busy={spinning}
      title={title}
      className={cn('shrink-0', className)}
      {...props}
    >
      <RefreshCw aria-hidden="true" className={cn(spinning && SPIN_CLASS)} />
    </Button>
  );
}
