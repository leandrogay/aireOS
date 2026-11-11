// Class strings shared by the forms and dialogs across features (inventory,
// customers, mappings, settings, upload). They match the cream/lavender inputs
// in promotions/PromotionForm.jsx, which keeps its own copies as local constants.

export const inputClass =
  'w-full min-w-0 max-w-full rounded-md border border-lavander bg-cream px-2.5 py-1.5 text-sm text-deep-violet-blue placeholder:text-deep-violet-blue/45 focus:border-violet focus:outline-none disabled:opacity-60';
export const invalidInputClass = 'border-red-400 focus:border-red-500';
export const labelClass = 'mb-1 block text-xs font-medium text-deep-violet-blue';
export const errorClass = 'mt-1 text-xs text-red-700';
export const hintClass = 'mt-1 text-[11px] text-deep-violet-blue/60';
export const checkRowClass =
  'flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-sm text-deep-violet-blue hover:bg-cream';
export const cardClass = 'aire-card p-4';

// Superseded by <Button> (default and outline variants, ui/button.jsx), which now
// carries this look itself. Kept until the files that still use them migrate.
export const primaryButtonClass =
  'h-auto border-deep-violet-blue bg-deep-violet-blue px-4 py-1.5 text-white hover:bg-deep-violet-blue/90';
export const secondaryButtonClass =
  'h-auto border-deep-violet-blue/30 bg-white px-4 py-1.5 text-deep-violet-blue hover:bg-cream';
