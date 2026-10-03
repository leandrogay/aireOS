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
        // Moving onto the icon or the text fires a leave on the panel too;
        // only a real exit should end the drag state, or the label flickers.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setIsDragging(false);
      }}
      onDrop={handleDrop}
      // A cool lavender tint, not the page's cream: in cream it read as a hole
      // in the white card. The tint marks it as its own target, and it
      // deepens on hover and goes solid while a file is held over it.
      className={`group flex flex-col items-center rounded-xl border-2 px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-violet-blue focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
        isDragging
          ? 'border-solid border-deep-violet-blue bg-lavander'
          : 'border-dashed border-violet bg-lavander/40 hover:border-deep-violet-blue/60 hover:bg-lavander/70'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      {/* White disc so the icon stands off the tint and gives the eye a
          starting point. */}
      <span
        aria-hidden="true"
        className={`flex size-14 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-violet/40 transition-transform ${
          isDragging ? 'scale-110' : 'group-hover:scale-105'
        }`}
      >
        <UploadCloud className="size-7 text-deep-violet-blue" />
      </span>
      <p className="mt-4 text-base font-medium text-deep-violet-blue">
        {isDragging ? (
          'Release to add files'
        ) : (
          <>
            Drop files here, or{' '}
            <span className="font-semibold underline decoration-violet decoration-2 underline-offset-4 group-hover:decoration-deep-violet-blue">
              click to browse
            </span>
          </>
        )}
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
