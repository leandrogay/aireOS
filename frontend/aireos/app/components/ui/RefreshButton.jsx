'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Icon-only refresh button that spins while a reload is in flight.
 *
 * Pass the page's own loading flag as `isRefreshing`: the arrow spins
 * while it is true and stops the moment it flips back to false, so no
 * extra state is needed at the call site. The button is disabled while
 * spinning so a double-click cannot queue a second reload.
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
  size = 'icon-sm',
  className,
  ...props
}) {
  const title = isRefreshing ? busyLabel : label;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={isRefreshing}
      aria-label={title}
      aria-busy={isRefreshing}
      title={title}
      className={className}
      {...props}
    >
      <RefreshCw aria-hidden="true" className={cn(isRefreshing && 'animate-spin')} />
    </Button>
  );
}
