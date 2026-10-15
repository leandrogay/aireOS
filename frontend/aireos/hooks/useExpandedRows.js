'use client';

import { useState } from 'react';

/**
 * Which rows of a list table are open (ExpandableRow). By default several
 * can be open at once; `{ multiple: false }` keeps one open at a time.
 * `expand` opens a row without closing it, for the row a save just created
 * or changed.
 *
 * @param {{ multiple?: boolean }} [options]
 * @returns {{
 *   isExpanded: (id: unknown) => boolean,
 *   toggle: (id: unknown) => void,
 *   expand: (id: unknown) => void,
 * }}
 */
export default function useExpandedRows({ multiple = true } = {}) {
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  function isExpanded(id) {
    return expandedIds.has(id);
  }

  function toggle(id) {
    setExpandedIds((current) => {
      if (current.has(id)) {
        const next = new Set(current);
        next.delete(id);
        return next;
      }
      return multiple ? new Set(current).add(id) : new Set([id]);
    });
  }

  function expand(id) {
    setExpandedIds((current) => (multiple ? new Set(current).add(id) : new Set([id])));
  }

  return { isExpanded, toggle, expand };
}
