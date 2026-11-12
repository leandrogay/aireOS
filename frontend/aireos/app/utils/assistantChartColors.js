// Colours for the assistant's chat chart (AssistantMessage's AssistantChart).
// A series or bar that is a customer is drawn in that customer's colour, the
// one it has on every page (utils/customerColors). Pure functions, no React.

import { findCustomerColor } from './customerColors.js';

// Second and later series that are not customers, in assistant.py's
// _SERIES_COLORS_HEX order (the exported files use the same).
const SERIES_COLORS = ['var(--aire-violet)', 'var(--aire-celest)', 'var(--aire-lavender)'];
const FIRST_SERIES_COLOR = 'var(--aire-deep-blue)';

/**
 * One colour per series. In order of precedence: the style's colour on the
 * first series (the user asked for it, backend chart_style.color); a forecast
 * line's own colour (forecastView FORECAST_SERIES); the customer's colour when
 * the series is named after one (backend _customer_label, "Sheng Siong");
 * else the AIRE palette.
 *
 * @param {{
 *   series: Array<{ label: string }>,
 *   forecastLines: Array<{ color: string } | undefined>,
 *   customColor: string | null,
 *   palette: { byName: Map<string, string> },
 * }} options
 * @returns {string[]}
 */
export function seriesColors({ series, forecastLines, customColor, palette }) {
  return series.map((item, index) => {
    if (index === 0 && customColor) return customColor;
    if (forecastLines[index]) return forecastLines[index].color;
    const customer = findCustomerColor(item.label, palette);
    if (customer) return customer;
    return index === 0 ? FIRST_SERIES_COLOR : SERIES_COLORS[(index - 1) % SERIES_COLORS.length];
  });
}

/**
 * Per-bar colours for a one-series bar chart whose categories are customers
 * ("revenue by customer"): each customer's bar in its colour, any other bar
 * null (it keeps the series colour). All null when no category is a customer,
 * or when the user picked a colour for the chart.
 *
 * @param {string[]} categories
 * @param {{ byName: Map<string, string> }} palette
 * @param {string | null} customColor
 * @returns {Array<string | null>}
 */
export function categoryColors(categories, palette, customColor = null) {
  if (customColor) return categories.map(() => null);
  return categories.map((category) => findCustomerColor(category, palette));
}
