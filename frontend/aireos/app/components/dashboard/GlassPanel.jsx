import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// The dashboard's shared surface. Keep the page's controls and data inside
// their existing feature components; only the card treatment lives here.
export default function GlassPanel({ as: Component = Card, className, children, ...props }) {
  return (
    <Component
      className={cn(
        'h-full gap-0 overflow-visible rounded-2xl border border-card/80 bg-card/75 p-4 text-deep-violet-blue shadow-xl shadow-deep-violet-blue/10 ring-1 ring-lavander/40 backdrop-blur-xl',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
