'use client';

import { Fragment } from 'react';
import { MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The "..." menu at the end of a customer or retailer row, in the promotions
 * list's look (PromotionRowActions): destructive items are red and sit after
 * a separator. An item with a `disabledReason` is greyed out and says why
 * underneath, because a disabled item cannot show a tooltip.
 *
 * @param {{
 *   label: string,
 *   actions: Array<{
 *     key: string,
 *     label: string,
 *     icon: import('react').ComponentType,
 *     onSelect: () => void,
 *     disabledReason?: string,
 *     destructive?: boolean,
 *   }>,
 * }} props
 */
export default function RowActions({ label, actions }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={label} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <Fragment key={action.key}>
              {action.destructive && index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                variant={action.destructive ? 'destructive' : 'default'}
                disabled={Boolean(action.disabledReason)}
                onClick={action.onSelect}
                className="items-start"
              >
                <Icon className="mt-0.5" />
                <span className="grid">
                  {action.label}
                  {action.disabledReason && (
                    <span className="text-[11px] text-deep-violet-blue/70">{action.disabledReason}</span>
                  )}
                </span>
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
