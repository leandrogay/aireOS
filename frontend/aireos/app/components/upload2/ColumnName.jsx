'use client';

import { Fragment } from 'react';
import { useShowWhitespace } from './whitespaceContext';

// Renders a source column name in monospace. When whitespace reveal is on,
// spaces show as "·" and tabs as "→" (dimmed), so trailing/embedded whitespace
// — which the contract matches character-for-character — is visible. Uses safe
// JSX per character instead of innerHTML.
export default function ColumnName({ value }) {
  const showWhitespace = useShowWhitespace();
  const text = String(value ?? '');

  if (!showWhitespace) {
    return <span className="font-mono">{text}</span>;
  }

  return (
    <span className="font-mono">
      {Array.from(text).map((char, index) => {
        if (char === ' ') {
          return (
            <span key={index} className="text-deep-violet-blue/30">
              ·
            </span>
          );
        }
        if (char === '\t') {
          return (
            <span key={index} className="text-deep-violet-blue/30">
              →
            </span>
          );
        }
        return <Fragment key={index}>{char}</Fragment>;
      })}
    </span>
  );
}