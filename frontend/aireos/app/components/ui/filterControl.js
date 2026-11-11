import { cn } from '@/lib/utils';

/**
 * The closed look every filter control shares -- FilterSelect, the tick-box
 * MultiSelectDropdown and a filter bar's own inputs -- so a bar of mixed
 * controls reads as one: the solid field look (formStyles inputClass), and
 * the solid brand border once it is narrowing the list (`active`).
 *
 * @param {boolean} active
 * @returns {string}
 */
export function filterControlClass(active) {
  return cn(
    'h-9 w-full min-w-0 rounded-glass-sm border bg-white px-2.5 text-sm font-normal text-deep-violet-blue outline-none transition-[border-color,background-color] duration-hover focus-ring',
    active ? 'border-deep-violet-blue' : 'border-deep-violet-blue/60 hover:border-deep-violet-blue/75',
  );
}
