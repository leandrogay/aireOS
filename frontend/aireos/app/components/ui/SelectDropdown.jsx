'use client';

import { Check, Plus } from 'lucide-react';

import Dropdown from '@/components/ui/Dropdown';
import { cn } from '@/lib/utils';

/**
 * Pick one option from a list, on the shared ui/Dropdown shell
 * (ui/MultiSelectDropdown is the pick-many version). The panel closes on a
 * pick and the picked row carries a tick -- `tick={false}` drops it (and the
 * space it keeps on every row) for a short list whose button already shows
 * the pick, like the page size; the picked row is still in bold.
 *
 * Options come as `options`, or as `groups` with a heading each ("Columns not
 * used yet"). An option can be `disabled`, with a `hint` saying why. A
 * `hint` is a few words beside the label; a `description` is a sentence under
 * it, wrapped, for a list whose options need explaining. The
 * button shows the picked option's label, or `placeholder` when `value`
 * matches none -- which is also how an action menu works: keep `value` at ''
 * and the button keeps saying "Map to…" after every pick.
 *
 * `action` pins one more row under the list -- "+ Create new customer" --
 * for when what is wanted is not in it. It is called with whatever was typed
 * in the search box, and `label` may be a function of that text, so a search
 * with no match can offer to create exactly that.
 *
 * @param {{
 *   value: string,
 *   onChange: (value: string) => void,
 *   options?: Array<{ value: string, label: string, disabled?: boolean, hint?: string, description?: string }>,
 *   groups?: Array<{ label?: string, options: Array<{ value: string, label: string, disabled?: boolean, hint?: string, description?: string }> }>,
 *   placeholder?: string,
 *   ariaLabel?: string,
 *   searchable?: boolean,
 *   searchPlaceholder?: string,
 *   look?: 'field' | 'filter' | 'compact' | 'outline',
 *   size?: 'md' | 'sm',
 *   disabled?: boolean,
 *   invalid?: boolean,
 *   id?: string,
 *   className?: string,
 *   triggerClassName?: string,
 *   tick?: boolean,
 *   action?: { label: string | ((query: string) => string), onSelect: (query: string) => void },
 * }} props
 */
export default function SelectDropdown({
  value,
  onChange,
  options,
  groups,
  placeholder = 'Select…',
  ariaLabel,
  searchable = false,
  searchPlaceholder = 'Search…',
  look = 'field',
  size = 'md',
  disabled = false,
  invalid = false,
  id,
  className,
  triggerClassName,
  tick = true,
  action,
}) {
  const allGroups = (groups || [{ options: options || [] }]).filter((group) => group.options.length);
  const current = allGroups.flatMap((group) => group.options).find((option) => option.value === value);

  return (
    <Dropdown
      summary={current?.label ?? ''}
      placeholder={placeholder}
      look={look}
      size={size}
      active={Boolean(value)}
      disabled={disabled}
      invalid={invalid}
      id={id}
      ariaLabel={ariaLabel}
      className={cn(className, triggerClassName)}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
      listRole="listbox"
      footer={action && ((query, close) => (
        // Pinned under the list, so it is there whatever the list scrolls to:
        // the way out when what is wanted is not in it.
        <button
          type="button"
          onClick={() => {
            close();
            action.onSelect(query.trim());
          }}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium text-deep-violet-blue outline-none hover:bg-cream focus-visible:bg-cream"
        >
          <Plus aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {typeof action.label === 'function' ? action.label(query.trim()) : action.label}
          </span>
        </button>
      ))}
    >
      {(query, close) => {
        const needle = query.trim().toLowerCase();
        const shown = allGroups
          .map((group) => ({
            ...group,
            options: needle ? group.options.filter((option) => option.label.toLowerCase().includes(needle)) : group.options,
          }))
          .filter((group) => group.options.length);

        if (!shown.length) return <p className="px-2 py-1 text-sm text-deep-violet-blue/60">No matches</p>;

        return shown.map((group, index) => (
          <div key={group.label || index} className={cn(index > 0 && 'mt-1 border-t border-lavander pt-1')}>
            {group.label && (
              <p className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-deep-violet-blue/60">{group.label}</p>
            )}
            {group.options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={`${option.value}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  onClick={() => {
                    close();
                    if (!selected) onChange(option.value);
                  }}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-deep-violet-blue outline-none hover:bg-cream focus-visible:bg-cream disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
                    selected && 'font-medium',
                  )}
                >
                  {tick && (
                    <Check
                      aria-hidden="true"
                      className={cn('size-3.5 shrink-0 self-start', option.description && 'mt-0.5', selected ? 'opacity-100' : 'opacity-0')}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {/* A hint gives way before the label does, so a long
                          one can never squeeze the label to "T…". */}
                      {option.hint && (
                        <span className="max-w-[45%] truncate text-[11px] text-deep-violet-blue/50" title={option.hint}>
                          {option.hint}
                        </span>
                      )}
                    </span>
                    {option.description && (
                      <span className="mt-0.5 block whitespace-normal text-[11px] leading-snug text-deep-violet-blue/55">
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ));
      }}
    </Dropdown>
  );
}
