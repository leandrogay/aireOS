'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { TABLE_HEADER_ACTION_CLASS } from '@/components/ui/SortHeader';
import { cn } from '@/lib/utils';

function toggleValue(selected, value) {
  return selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
}

// A table header button that opens a portal-rendered checkbox list,
// positioned relative to the button so it still works inside a
// scrolling/overflow-hidden table header. TableGrid draws one for a column
// with `filter`; ForecastTable also uses it on its own above the phone cards.
export default function HeaderCheckboxFilter({ id, label, selected, options, openId, setOpenId, onChange }) {
  const open = openId === id;
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, maxHeight: 256 });
  const isActive = selected.length > 0;

  useEffect(() => {
    if (!open || !buttonRef.current) return undefined;

    const placeMenu = () => {
      const rect = buttonRef.current.getBoundingClientRect();
      const maxHeight = 256;
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
      const height = Math.max(120, Math.min(maxHeight, openUp ? spaceAbove : spaceBelow));

      setMenuPos({
        top: openUp ? rect.top - height - 6 : rect.bottom + 6,
        left: Math.min(rect.left, window.innerWidth - 220),
        maxHeight: height,
      });
    };

    placeMenu();
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    return () => {
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (buttonRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) {
        return;
      }
      setOpenId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, setOpenId]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpenId(open ? null : id)}
        className={cn(TABLE_HEADER_ACTION_CLASS, 'max-w-[11rem] whitespace-nowrap', isActive && 'font-semibold text-deep-violet-blue')}
      >
        <span className="truncate">{label}</span>
        {isActive ? <span className="text-[9px] font-bold">{selected.length}</span> : null}
        <ChevronDown aria-hidden="true" className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable="true"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              maxHeight: menuPos.maxHeight,
            }}
            className="fixed z-50 flex min-w-[12rem] flex-col overflow-hidden rounded-xl border border-lavander bg-white shadow-lg"
          >
            {isActive ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="shrink-0 cursor-pointer border-b border-lavander bg-white px-3 py-1.5 text-left text-[11px] font-medium text-deep-violet-blue hover:bg-lavander/50"
              >
                Clear
              </button>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {options.length === 0 ? (
                <p className="px-3 py-2 text-[11px] font-normal normal-case tracking-normal text-deep-violet-blue/70">
                  No values in the current data.
                </p>
              ) : (
                options.map((option) => {
                  const checked = selected.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] font-normal normal-case tracking-normal text-deep-violet-blue hover:bg-lavander/50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onChange(toggleValue(selected, option.value))}
                        className="size-3.5 accent-deep-violet-blue"
                      />
                      {option.label}
                    </label>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
