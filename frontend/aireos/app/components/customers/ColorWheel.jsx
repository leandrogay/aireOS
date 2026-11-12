'use client';

import { useRef } from 'react';

import {
  hslToHex,
  hueSatToPoint,
  pointToHueSat,
  wheelBackground,
} from '@/app/utils/colorWheel';
import { labelClass } from '@/components/ui/formStyles';

const SIZE = 176;
const RADIUS = SIZE / 2;
// Arrow keys move the marker this far: hue in degrees, saturation in percent.
const KEY_STEP = 5;

/**
 * A colour wheel: drag (or click) on the wheel for hue and saturation, the
 * slider for lightness. Arrow keys on the wheel move the marker: left/right
 * turn the hue, up/down change the saturation. The maths is in
 * utils/colorWheel.js.
 *
 * @param {{
 *   value: { h: number, s: number, l: number },
 *   onChange: (hsl: { h: number, s: number, l: number }) => void,
 * }} props
 */
export default function ColorWheel({ value, onChange }) {
  const wheelRef = useRef(null);
  const marker = hueSatToPoint(value, RADIUS);
  const hex = hslToHex(value);

  function pickAt(event) {
    const box = wheelRef.current.getBoundingClientRect();
    const { h, s } = pointToHueSat(event.clientX - box.left, event.clientY - box.top, box.width / 2);
    onChange({ ...value, h, s });
  }

  function handleKeyDown(event) {
    const moves = {
      ArrowLeft: { h: (value.h - KEY_STEP + 360) % 360 },
      ArrowRight: { h: (value.h + KEY_STEP) % 360 },
      ArrowUp: { s: Math.min(value.s + KEY_STEP, 100) },
      ArrowDown: { s: Math.max(value.s - KEY_STEP, 0) },
    };
    if (!moves[event.key]) return;
    event.preventDefault();
    onChange({ ...value, ...moves[event.key] });
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <div
        ref={wheelRef}
        role="slider"
        tabIndex={0}
        aria-label="Hue and saturation"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={value.h}
        aria-valuetext={`Hue ${value.h} degrees, saturation ${value.s}%`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pickAt(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pickAt(event);
        }}
        onKeyDown={handleKeyDown}
        // No border: the gradient showed through a translucent border and
        // frayed the rim. A 1px shadow outlines it instead, and the focus ring
        // sits outside it (offset) rather than over the colours.
        className="relative shrink-0 cursor-crosshair touch-none rounded-full shadow-[0_0_0_1px_rgba(58,67,105,0.15)] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2"
        style={{ width: SIZE, height: SIZE, background: wheelBackground(value.l), backgroundClip: 'padding-box' }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{ left: marker.x, top: marker.y, backgroundColor: hex }}
        />
      </div>

      <div className="flex w-36 flex-col gap-3">
        <div>
          <label htmlFor="color-wheel-lightness" className={labelClass}>
            Lightness
          </label>
          <input
            id="color-wheel-lightness"
            type="range"
            min={0}
            max={100}
            value={value.l}
            onChange={(event) => onChange({ ...value, l: Number(event.target.value) })}
            className="w-full cursor-pointer accent-deep-violet-blue"
          />
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-9 shrink-0 rounded-md border border-deep-violet-blue/15"
            style={{ backgroundColor: hex }}
          />
          <span className="font-mono text-sm text-deep-violet-blue">{hex}</span>
        </div>
      </div>
    </div>
  );
}
