// See backend get_inventory_position_rows / forecasting_inventory_position.
import { formatMonthLabel } from './forecastView';

const NUMERIC_FIELDS = [
  'opening_inventory',
  'actual_sell_in',
  'recommended_sell_in',
  'actual_sell_out',
  'forecast_sell_out',
  'actual_closing_inventory',
  'predicted_closing_inventory',
  'inventory_position',
  'inventory_variance',
];

function emptyPoint(monthYear) {
  const point = { month_year: monthYear, label: formatMonthLabel(monthYear) };
  for (const field of NUMERIC_FIELDS) point[field] = null;
  return point;
}

// Sums matching rows into one point per month -- a broad filter (e.g. no
// product selected) can return more than one row per month, same as the
// sell-out forecast table's buildMonthlyPoints.
export function buildInventoryPoints(rows) {
  const byMonth = new Map();

  for (const row of rows) {
    if (!byMonth.has(row.month_year)) byMonth.set(row.month_year, emptyPoint(row.month_year));
    const point = byMonth.get(row.month_year);
    for (const field of NUMERIC_FIELDS) {
      const value = row[field];
      if (value == null) continue;
      point[field] = (point[field] ?? 0) + value;
    }
  }

  return [...byMonth.values()].sort((a, b) => a.month_year.localeCompare(b.month_year));
}

// A month has either an actual or a predicted/recommended/forecast value,
// never both (see closing_inventory_for_month on the backend) -- these pick
// whichever one exists so the table can show one column per concept.
export function closingInventoryForPoint(point) {
  return { value: point.actual_closing_inventory ?? point.predicted_closing_inventory, isActual: point.actual_closing_inventory != null };
}

export function sellInForPoint(point) {
  return { value: point.actual_sell_in ?? point.recommended_sell_in, isActual: point.actual_sell_in != null };
}

export function sellOutForPoint(point) {
  return { value: point.actual_sell_out ?? point.forecast_sell_out, isActual: point.actual_sell_out != null };
}
