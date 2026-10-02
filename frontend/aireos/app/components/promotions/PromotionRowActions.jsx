'use client';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The "..." menu at the end of a promotion row. Delete is separated and red
 * so the two actions are never confused; it only opens the confirm dialog,
 * nothing is removed from here.
 *
 * @param {{
 *   promotion: object,
 *   isEditing: boolean,
 *   onEdit: (promotion: object) => void,
 *   onDelete: (promotion: object) => void,
 * }} props
 */
export default function PromotionRowActions({ promotion, isEditing, onEdit, onDelete }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for promotion ${promotion.promotion_id}`}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem disabled={isEditing} onClick={() => onEdit(promotion)}>
          <Pencil />
          {isEditing ? 'Editing now' : 'Edit'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(promotion)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
