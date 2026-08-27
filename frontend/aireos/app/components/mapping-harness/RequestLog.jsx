'use client';

import { useEffect, useRef } from 'react';

// Colour per log-line kind. Restyled from the HTML's dark console into the
// project's light palette while keeping the four kinds distinguishable.
const KIND_CLASS = {
  t: 'text-deep-violet-blue/50',
  req: 'text-violet',
  res: 'text-green-700',
  er: 'text-red-600',
};

// Read-only console of every request, response, and error, newest at the
// bottom. Auto-scrolls as lines arrive.
export default function RequestLog({ lines }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <section className="mb-8 rounded-lg border border-lavander bg-white p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="font-serif text-2xl text-deep-violet-blue">Request log</h2>
      </div>
      <div
        ref={scrollRef}
        className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-lavander bg-cream/40 p-3 font-mono text-xs leading-relaxed"
      >
        {lines.map((line) => (
          <div key={line.id}>
            <span className="text-deep-violet-blue/40">{line.time}</span>{' '}
            <span className={KIND_CLASS[line.kind] || KIND_CLASS.t}>{line.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}