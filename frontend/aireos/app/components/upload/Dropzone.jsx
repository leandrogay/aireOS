'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { ACCEPT_ATTRIBUTE, UPLOAD_LIMITS_TEXT } from '../../config/upload';

/**
 * The drop target. The whole panel is one control: click it anywhere, or tab
 * to it and press Enter or Space. There is no separate "Browse" button to
 * miss, and the focus ring is on the thing that actually takes the keypress.
 *
 * @param {{ onFiles: (files: FileList | File[]) => void, disabled?: boolean }} props
 */
export default function Dropzone({ onFiles, disabled = false }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const openPicker = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // Space scrolls the page otherwise, and Enter would submit an enclosing
      // form rather than open the picker.
      event.preventDefault();
      openPicker();
    },
    [openPicker],
  );

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      onFiles(event.dataTransfer.files);
    },
    [disabled, onFiles],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Add sales data files: drop them here, or activate to browse"
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragging(false);
      }}
      onDrop={handleDrop}
      className={`flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
        isDragging
          ? 'border-deep-violet-blue bg-lavander'
          : 'border-violet bg-cream hover:border-deep-violet-blue hover:bg-lavander'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <UploadCloud aria-hidden="true" className="size-8 text-deep-violet-blue" />
      <p className="mt-3 text-base font-medium text-deep-violet-blue">
        Drop files here, or click to browse
      </p>
      <p className="mt-1 text-sm text-deep-violet-blue/70">{UPLOAD_LIMITS_TEXT}</p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          onFiles(event.target.files);
          // Let the same file be picked again after it is removed.
          event.target.value = '';
        }}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
