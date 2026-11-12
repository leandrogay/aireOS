import { Card } from '@/components/ui/card';
import { glassSurfaceClass } from '@/components/ui/surfaceStyles';
import { cn } from '@/lib/utils';

// Keep the page's controls and data inside their existing feature components;
// the outer surface is shared with the other app pages.
export default function GlassPanel({ as: Component = Card, className, children, ...props }) {
  return (
    <Component
      className={cn(
        glassSurfaceClass,
        'h-full gap-0 overflow-visible p-4 text-deep-violet-blue',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
