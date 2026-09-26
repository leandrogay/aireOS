// Pure helpers for the inventory forms and views: validation, payloads and
// display formatting. No React in here. Field names in the payloads mirror the
// backend schemas in app/schemas/inventory.py (InventoryRecordBase,
// ShippedSoFarUpdate); change them together.

// ============================================================
// Inventory record form
// ============================================================

export const EMPTY_INVENTORY_FORM = {
  customerIds: [],
  sku: '',
  month: '', // 'YYYY-MM', straight from <input type="month">
  sellIn: '',
  openingInventory: '',
};

// A quantity is a whole number of units: digits only, so 0 or more with no decimals.
const QUANTITY_PATTERN = /^\d+$/;

/**
 * @param {string} value
 * @returns {boolean} true for '0', '12'; false for '', '-1', '3.5', '1e3', 'abc'
 */
function isQuantity(value) {
  return QUANTITY_PATTERN.test(String(value).trim());
}

/**
 * The month the wall clock is in, as 'YYYY-MM'. Actuals can only be entered
 * for months before this one (the backend refuses an unfinished month too).
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function currentMonthInput(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * @param {typeof EMPTY_INVENTORY_FORM} form
 * @param {{ isEdit?: boolean, now?: Date }} [options]
 * @returns {Record<string, string>} field name -> message; empty when valid
 */
export function validateInventoryForm(form, { isEdit = false, now = new Date() } = {}) {
  const errors = {};

  if (!isEdit && form.customerIds.length === 0) {
    errors.customerIds = 'Choose at least one customer.';
  }
  if (!form.sku) {
    errors.sku = 'Choose a SKU.';
  }
  if (!/^\d{4}-\d{2}$/.test(form.month)) {
    errors.month = 'Choose a month.';
  } else if (form.month >= currentMonthInput(now)) {
    errors.month = 'That month has not ended yet. Use Temporary sell-in for sell-in already sent this month.';
  }
  if (!isQuantity(form.sellIn)) {
    errors.sellIn = 'Enter sell-in as a whole number of 0 or more.';
  }
  if (form.openingInventory !== '' && !isQuantity(form.openingInventory)) {
    errors.openingInventory = 'Opening inventory must be a whole number of 0 or more.';
  }

  return errors;
}

/**
 * @param {typeof EMPTY_INVENTORY_FORM} form a form that passed validateInventoryForm
 * @returns {{ customer_ids: number[], sku: string, month: string, sell_in: number, opening_inventory: number | null }}
 */
export function buildInventoryPayload(form) {
  return {
    customer_ids: form.customerIds,
    sku: form.sku,
    month: `${form.month}-01`,
    sell_in: Number(form.sellIn),
    opening_inventory: form.openingInventory === '' ? null : Number(form.openingInventory),
  };
}

/**
 * Pre-fills the edit form from a table row of the overview / customer view
 * (see backend inventory_service._stock_row).
 *
 * @param {{ customer_id: number, sku: string, month: string, sell_in: number }} row
 * @returns {typeof EMPTY_INVENTORY_FORM}
 */
export function formFromRow(row) {
  return {
    customerIds: [row.customer_id],
    sku: row.sku,
    month: row.month.slice(0, 7),
    sellIn: String(row.sell_in),
    openingInventory: '',
  };
}

// ============================================================
// Temporary sell-in form
// ============================================================

export const EMPTY_SHIPPED_FORM = { customerIds: [], sku: '', month: '', shippedSoFar: '' };

/**
 * Temporary sell-in is for a month that has no actuals yet. That is decided by
 * the data, not the calendar: a month can be over and still have no actuals
 * entered (August, with actuals only to July), so it is still allowed here. The
 * server refuses a month that already has actuals for the SKU.
 *
 * @param {typeof EMPTY_SHIPPED_FORM} form
 * @returns {Record<string, string>} field name -> message; empty when valid
 */
export function validateShippedForm(form) {
  const errors = {};

  if (form.customerIds.length === 0) {
    errors.customerIds = 'Choose at least one customer.';
  }
  if (!form.sku) {
    errors.sku = 'Choose a SKU.';
  }
  if (!/^\d{4}-\d{2}$/.test(form.month)) {
    errors.month = 'Choose a month.';
  }
  if (!isQuantity(form.shippedSoFar)) {
    errors.shippedSoFar = 'Enter the temporary sell-in as a whole number of 0 or more.';
  }

  return errors;
}

/**
 * @param {typeof EMPTY_SHIPPED_FORM} form a form that passed validateShippedForm
 * @returns {{ customer_ids: number[], sku: string, month: string, shipped_so_far: number }}
 */
export function buildShippedPayload(form) {
  return {
    customer_ids: form.customerIds,
    sku: form.sku,
    month: `${form.month}-01`,
    shipped_so_far: Number(form.shippedSoFar),
  };
}

// ============================================================
// Display formatting
// ============================================================

/**
 * @param {string} monthValue 'YYYY-MM' from <input type="month"> or ''
 * @returns {string} 'YYYY-MM-01' for the API, or ''
 */
export function monthInputToDate(monthValue) {
  return monthValue ? `${monthValue}-01` : '';
}

/**
 * The newest month among rows, used as the month range the tables open on.
 *
 * @param {Array<{ month: string }>} rows rows from the API ('YYYY-MM-DD' months)
 * @returns {string} 'YYYY-MM' for <input type="month">, or '' when there are no rows
 */
export function latestMonthInput(rows) {
  return rows.reduce((latest, row) => (row.month.slice(0, 7) > latest ? row.month.slice(0, 7) : latest), '');
}

/**
 * Keeps the rows whose month falls inside the range. The backend returns the
 * full history and the range is applied here, so the charts can keep the whole
 * history while the tables narrow to the range.
 *
 * @template {{ month: string }} T
 * @param {T[]} rows
 * @param {string} startMonth 'YYYY-MM' or '' (no lower bound)
 * @param {string} endMonth 'YYYY-MM' or '' (no upper bound)
 * @returns {T[]}
 */
export function filterMonthRange(rows, startMonth, endMonth) {
  return rows.filter((row) => {
    const month = row.month.slice(0, 7);
    return (!startMonth || month >= startMonth) && (!endMonth || month <= endMonth);
  });
}

const MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * @param {string} isoDate 'YYYY-MM-DD'
 * @returns {string} e.g. 'Jul 2026'
 */
export function formatMonth(isoDate) {
  return MONTH_FORMAT.format(new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`));
}

/**
 * @param {number | null | undefined} value
 * @returns {string} whole units with thousands separators, or a dash
 */
export function formatUnits(value) {
  if (value === null || value === undefined) return '—';
  return Math.round(value).toLocaleString('en-GB');
}

/**
 * @param {number | null | undefined} value
 * @returns {string} one decimal place, or a dash when DOH could not be measured
 */
export function formatDoh(value) {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * @param {number | null | undefined} value
 * @returns {string} signed one-decimal gap such as '+2.5' or '-8.5', or a dash
 */
export function formatGap(value) {
  if (value === null || value === undefined) return '—';
  return `${value > 0 ? '+' : ''}${formatDoh(value)}`;
}

export const DOH_STATUS_LABELS = {
  below_min: 'Below min',
  within: 'Within range',
  above_max: 'Above max',
};
