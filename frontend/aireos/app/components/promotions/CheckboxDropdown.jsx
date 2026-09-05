'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Closed-by-default dropdown whose menu is a checkbox list.
 *
 * The trigger looks like the other cream/lavender inputs. Clicking it opens
 * the panel; clicking outside closes it. Selection stays in the parent —
 * this component only controls open/close.
 *
 * @param {object} props
 * @param {string} props.summary text shown on the closed button
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {React.ReactNode} props.children checkbox rows
 */
export default function CheckboxDropdown({
  summary,
  placeholder = 'Select…',
  disabled = false,
  children,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  /**
   * Close the menu when the pointer lands outside this dropdown.
   */
  useEffect(() => {
    /**
     * @param {MouseEvent} event
     */
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-md border border-lavander bg-cream px-2.5 py-1.5 text-left text-sm text-deep-violet-blue focus:border-violet focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={summary ? '' : 'text-deep-violet-blue/50'}>
          {summary || placeholder}
        </span>
        <span className="ml-2 text-[10px] text-deep-violet-blue/50" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-lavander bg-white p-2 shadow-md">
          {children}
        </div>
      )}
    </div>
  );
}
