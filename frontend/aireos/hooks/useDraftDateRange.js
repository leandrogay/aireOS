'use client';

import { useState } from 'react';

/**
 * Local "draft" state for a two-field (start, end) date range editor that
 * only commits to the parent once both fields are filled and valid (start
 * <= end) — a half-set range would otherwise send a nonsensical query. If a
 * range was previously active and the user clears one side, the filter is
 * dropped rather than silently kept on the old range. Stays in sync when
 * the committed range changes from outside (e.g. a filter badge's clear
 * button, or another control driving the same shared state) — adjusted
 * during render rather than an effect, per React's guidance on resetting
 * state when a prop changes.
 */
export default function useDraftDateRange(start, end, onChange) {
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  const [synced, setSynced] = useState([start, end]);

  if (synced[0] !== start || synced[1] !== end) {
    setSynced([start, end]);
    setDraftStart(start);
    setDraftEnd(end);
  }

  function commit(nextStart, nextEnd) {
    setDraftStart(nextStart);
    setDraftEnd(nextEnd);
    if (nextStart && nextEnd && nextStart <= nextEnd) {
      onChange(nextStart, nextEnd);
    } else if (start || end) {
      onChange('', '');
    }
  }

  return {
    draftStart,
    draftEnd,
    onStartChange: (value) => commit(value, draftEnd),
    onEndChange: (value) => commit(draftStart, value),
  };
}
