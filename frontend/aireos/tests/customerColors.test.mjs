// Customer colours: each customer's stored colour (customers.color), whatever
// name a page uses for the customer, plus the shades used inside one customer (store formats,
// sell-in beside sell-out) and the assistant chart's colours.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { categoryColors, seriesColors } from '../app/utils/assistantChartColors.js';
import {
  NO_CUSTOMER_COLOR,
  customerColor,
  customerColorById,
  customerPalette,
  customerShades,
  findCustomerColor,
  shadeColor,
} from '../app/utils/customerColors.js';
import { UNNAMED_FORMAT, formatShadeLookup, rankFormats } from '../app/utils/storeFormats.js';

// The customer records as GET /api/inventory/customers returns them, renamed,
// each with its stored colour.
const RECORDS = [
  { customer_id: 1, customer_name: 'FairPrice', color: '#7A70B8' },
  { customer_id: 21, customer_name: 'NHG', color: '#2E7BA6' },
  { customer_id: 23, customer_name: 'Prime', color: '#6B8E23' },
  { customer_id: 16, customer_name: 'Sheng_Shiong', color: '#9A7B00' },
  { customer_id: 22, customer_name: 'SingHealth', color: '#C45C26' },
];

// The dashboard's Customer filter options, named from the sales data, with
// the linked customer's colour.
const OPTIONS = RECORDS.map((record) => ({
  value: { 1: 'fairprice', 21: 'nhg', 23: 'prime', 16: 'sheng_siong', 22: 'singhealth' }[record.customer_id],
  label: record.customer_name.replace('_', ' '),
  customer_id: record.customer_id,
  color: record.color,
}));

// Every line colour on Forecast / Scenario (forecastView FORECAST_SERIES,
// scenarioEngine's Simulated, scenarioModelView) and the Sell-in Outlook
// (SellInOutlookChart SERIES), as backend customer_colors.LINE_COLORS. A
// fallback customer colour must not be mistaken for one of these.
const LINE_COLORS = [
  '#3A4369', '#E8922A', '#7C3AED', '#0D9488',
  '#D23F74', '#9AA0B4',
  '#0B4FD9', '#00AEC2', '#1E9E3A', '#7F4A08', '#E02FA6', '#F58A00',
];

// CIE76 colour difference, enough to tell "looks the same" from "different".
function toLab(hex) {
  const linear = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = linear;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a, b) {
  const [p, q] = [toLab(a), toLab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ---- Palette ----

describe('customerPalette', () => {
  test('one customer is the same colour by sales slug, record name and label', () => {
    const palette = customerPalette(RECORDS, OPTIONS);
    const colour = customerColorById(16, palette);
    assert.equal(customerColor('sheng_siong', palette), colour);
    assert.equal(customerColor('Sheng_Shiong', palette), colour);
    assert.equal(customerColor('Sheng Siong', palette), colour);
  });

  test("every customer is drawn in its stored colour", () => {
    const palette = customerPalette(RECORDS, OPTIONS);
    for (const record of RECORDS) assert.equal(customerColorById(record.customer_id, palette), record.color);
  });

  test('options alone carry the stored colours, if the records could not be read', () => {
    const palette = customerPalette([], OPTIONS);
    assert.equal(customerColor('sheng_siong', palette), '#9A7B00');
  });

  test('records alone give the same colours as records with options', () => {
    const withOptions = customerPalette(RECORDS, OPTIONS);
    const recordsOnly = customerPalette(RECORDS);
    for (const record of RECORDS) {
      assert.equal(customerColor(record.customer_name, recordsOnly), customerColorById(record.customer_id, withOptions));
    }
  });

  test('a renamed customer keeps its colour, because colours are by customer_id', () => {
    const before = customerPalette(RECORDS);
    const renamed = customerPalette(RECORDS.map((r) => (r.customer_id === 1 ? { ...r, customer_name: 'NTUC FairPrice' } : r)));
    assert.equal(customerColor('NTUC FairPrice', renamed), customerColor('FairPrice', before));
    assert.equal(customerColorById(1, renamed), '#7A70B8');
  });

  test('a customer with no stored colour takes a fallback no one else has', () => {
    const records = [...RECORDS, { customer_id: 2, customer_name: 'Giant', color: '#2D4A22' }, { customer_id: 30, customer_name: 'Cold_Storage', color: null }];
    const palette = customerPalette(records);
    const coldStorage = customerColorById(30, palette);
    assert.ok(!records.some((record) => record.color === coldStorage));
  });

  test('a new customer with no stored colour changes nobody else', () => {
    const before = customerPalette(RECORDS);
    const after = customerPalette([...RECORDS, { customer_id: 30, customer_name: 'Giant', color: null }]);
    for (const record of RECORDS) {
      assert.equal(customerColorById(record.customer_id, after), customerColorById(record.customer_id, before));
    }
    const giant = customerColorById(30, after);
    assert.ok(!RECORDS.some((record) => customerColorById(record.customer_id, after) === giant));
  });

  test('an option with no customer record takes a colour after every record', () => {
    const palette = customerPalette(
      [...RECORDS, { customer_id: 30, customer_name: 'Giant' }],
      [...OPTIONS, { value: 'cold_storage', customer_id: null }],
    );
    const giant = customerColorById(30, palette);
    const coldStorage = customerColor('cold_storage', palette);
    assert.notEqual(coldStorage, NO_CUSTOMER_COLOR);
    assert.notEqual(coldStorage, giant);
  });

  test('a name that is no customer is the no-customer colour, or null when asked to find it', () => {
    const palette = customerPalette(RECORDS, OPTIONS);
    assert.equal(customerColor('All customers', palette), NO_CUSTOMER_COLOR);
    assert.equal(findCustomerColor('Current', palette), null);
    assert.equal(findCustomerColor('fairprice', undefined), null);
  });

  test('no fallback customer colour looks like a forecast or outlook line', () => {
    const spares = customerPalette(
      [100, 101, 102, 103, 104].map((id) => ({ customer_id: id, customer_name: `c${id}` })),
    );
    for (const colour of spares.byId.values()) {
      for (const line of LINE_COLORS) {
        assert.ok(deltaE(colour, line) >= 25, `${colour} is too close to line colour ${line}`);
      }
    }
  });
});

// ---- Shades ----

describe('customerShades', () => {
  test('the first shade is the colour itself and every shade differs', () => {
    const shades = customerShades('#7A70B8', 5);
    assert.equal(shades[0], '#7A70B8');
    assert.equal(new Set(shades).size, 5);
  });

  test('a hex colour is mixed toward white for a lighter shade and black for a darker one', () => {
    assert.equal(shadeColor('#000000', 0.5), '#808080');
    assert.equal(shadeColor('#FFFFFF', -0.5), '#808080');
  });

  test('a CSS variable is shaded with color-mix', () => {
    assert.equal(shadeColor('var(--aire-deep-blue)', 0.4), 'color-mix(in srgb, var(--aire-deep-blue), white 40%)');
  });
});

// ---- Store format shades ----

describe('rankFormats', () => {
  test('biggest format by revenue first, comparison-only formats next, Others last', () => {
    const ranked = rankFormats(
      [{ format: 'SUPER', revenue: 50 }, { format: 'Others', revenue: 900 }, { format: 'HYPER', revenue: 100 }],
      [{ format: 'FINEST', revenue: 10 }, { format: 'HYPER', revenue: 5 }],
    );
    assert.deepEqual(ranked, ['HYPER', 'SUPER', 'FINEST', 'Others']);
  });
});

describe('formatShadeLookup', () => {
  test('the biggest format and the unnamed series take the customer colour itself', () => {
    const colorFor = formatShadeLookup(['HYPER', 'SUPER'], '#7A70B8');
    assert.equal(colorFor('HYPER'), '#7A70B8');
    assert.equal(colorFor(UNNAMED_FORMAT), '#7A70B8');
    assert.equal(colorFor('SUPER'), customerShades('#7A70B8', 2)[1]);
  });

  test('a format outside the ranking takes the next shade, not one already in use', () => {
    const colorFor = formatShadeLookup(['HYPER', 'SUPER'], '#7A70B8');
    assert.ok(![colorFor('HYPER'), colorFor('SUPER')].includes(colorFor('UNITY')));
  });
});

// ---- Assistant chart ----

describe('assistant chart colours', () => {
  const palette = customerPalette(RECORDS, OPTIONS);

  test('a series named after a customer takes its colour; others keep the palette', () => {
    const colors = seriesColors({
      series: [{ label: 'Fairprice' }, { label: 'Sheng Siong' }, { label: 'Other' }],
      forecastLines: [undefined, undefined, undefined],
      customColor: null,
      palette,
    });
    assert.deepEqual(colors.slice(0, 2), ['#7A70B8', '#9A7B00']);
    assert.equal(colors[2], 'var(--aire-celest)');
  });

  test("the user's chosen colour and forecast lines win over customer colours", () => {
    const colors = seriesColors({
      series: [{ label: 'Fairprice' }, { label: 'Current' }],
      forecastLines: [undefined, { color: '#0D9488' }],
      customColor: '#FF0000',
      palette,
    });
    assert.deepEqual(colors, ['#FF0000', '#0D9488']);
  });

  test('bars whose categories are customers take each customer colour', () => {
    assert.deepEqual(categoryColors(['NHG', 'Previous'], palette), ['#2E7BA6', null]);
    assert.deepEqual(categoryColors(['NHG'], palette, '#FF0000'), [null]);
  });
});
