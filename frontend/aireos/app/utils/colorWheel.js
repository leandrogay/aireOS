// The colour wheel on the Customers page (customers/ColorWheel.jsx): hue goes
// round the wheel clockwise from the top, saturation from grey at the centre
// to full at the rim, and lightness is a slider beside it. Pure functions, no
// React. Colours cross the API as #RRGGBB (backend CustomerColorUpdate).

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * @param {{ h: number, s: number, l: number }} hsl hue 0-360, saturation and lightness 0-100
 * @returns {string} #RRGGBB, uppercase
 */
export function hslToHex({ h, s, l }) {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

/**
 * @param {string} hex #RRGGBB
 * @returns {{ h: number, s: number, l: number }}
 */
export function hexToHsl(hex) {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: Math.round(h * 60) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * The hue and saturation at a point on the wheel. `x`, `y` are measured from
 * the wheel's top-left corner; a point past the rim counts as the rim.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {{ h: number, s: number }}
 */
export function pointToHueSat(x, y, radius) {
  const dx = x - radius;
  const dy = y - radius;
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return {
    h: Math.round((angle + 360) % 360),
    s: Math.round(clamp(Math.hypot(dx, dy) / radius, 0, 1) * 100),
  };
}

/**
 * Where a hue and saturation sit on the wheel, from its top-left corner (the
 * marker's position).
 *
 * @param {{ h: number, s: number }} hueSat
 * @param {number} radius
 * @returns {{ x: number, y: number }}
 */
export function hueSatToPoint({ h, s }, radius) {
  const angle = (h * Math.PI) / 180;
  const distance = (s / 100) * radius;
  return { x: radius + Math.sin(angle) * distance, y: radius - Math.cos(angle) * distance };
}

/**
 * The CSS background that draws the wheel at one lightness: the hues round a
 * conic gradient, fading to that lightness's grey at the centre.
 *
 * @param {number} lightness 0-100
 * @returns {string}
 */
export function wheelBackground(lightness) {
  const hues = Array.from({ length: 7 }, (_, i) => `hsl(${i * 60} 100% ${lightness}%)`).join(', ');
  return `radial-gradient(closest-side, hsl(0 0% ${lightness}%), transparent), conic-gradient(${hues})`;
}
