import { cn } from '@/lib/utils';

/**
 * A customer's chart colour as a small dot (customers.color). A customer with
 * no stored colour shows an empty dashed dot: its charts use a fallback
 * colour until one is picked.
 *
 * @param {{ color?: string | null, className?: string }} props
 */
export default function CustomerSwatch({ color, className }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-3 shrink-0 rounded-full border align-[-1px]',
        color ? 'border-deep-violet-blue/20' : 'border-dashed border-deep-violet-blue/40',
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
