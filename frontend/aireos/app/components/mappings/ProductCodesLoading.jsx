import { Loader2 } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Step 3 while the file's product codes are being read (the test that starts
 * when a product code column is chosen): a line saying so, and bars shaped
 * like the code table's rows so the card does not jump when they arrive.
 */
export default function ProductCodesLoading() {
  return (
    <div role="status" className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-deep-violet-blue/70">
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        Reading the product codes in the example file…
      </p>
      <div aria-hidden="true" className="divide-y divide-lavander/80 rounded-lg border border-deep-violet-blue/15 bg-white">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-4 px-3 py-2.5">
            <Skeleton className="h-3.5 w-20 rounded bg-lavander" />
            <Skeleton className="h-3.5 flex-1 rounded bg-lavander" />
            <Skeleton className="h-7 w-40 rounded-md bg-lavander" />
          </div>
        ))}
      </div>
    </div>
  );
}
