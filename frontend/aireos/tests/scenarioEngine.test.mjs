import test from 'node:test';
import assert from 'node:assert/strict';

import { chartView, coversCustomer, itemRows, splitBasisNeeds, unitsDeltaCells, viewCoversItem } from '../app/utils/scenarioEngine.js';

const MONTH = '2027-06-01';

function row(customer, product, current) {
  return { customer_name: customer, product_name: product, sku_range: 'Pants', month_year: MONTH, forecast_current: current };
}

const ROWS = [row('FairPrice', 'A', 300), row('FairPrice', 'B', 100), row('NHG', 'A', 200), row('Prime', 'A', 50)];

function block(customers, extra = {}) {
  return { id: 'b1', customers, skuRanges: [], sku: '', startMonth: MONTH, endMonth: MONTH, ...extra };
}

// ---- which customers an item covers ------------------------------------------------

test('a block covers the customers it names, or every customer when it names none', () => {
  assert.equal(coversCustomer(block(['FairPrice', 'NHG']), 'NHG'), true);
  assert.equal(coversCustomer(block(['FairPrice', 'NHG']), 'Prime'), false);
  assert.equal(coversCustomer(block([]), 'Prime'), true);
  // A promotion still names one customer.
  assert.equal(coversCustomer({ customer: 'NHG' }, 'NHG'), true);
  assert.equal(coversCustomer({ customer: '' }, 'NHG'), false);
});

test('a block for several customers applies to all of their rows', () => {
  assert.deepEqual(
    itemRows(ROWS, block(['FairPrice', 'NHG'])).map((r) => `${r.customer_name}/${r.product_name}`),
    ['FairPrice/A', 'FairPrice/B', 'NHG/A']
  );
  assert.equal(itemRows(ROWS, block([])).length, 4);
});

// ---- units ------------------------------------------------------------------------------

test('each customer of a units block gets the full number of units, split over its own SKUs', () => {
  const cells = unitsDeltaCells(ROWS, block(['FairPrice', 'NHG']), 100, 'blocks', chartView({}));
  const byCustomer = (name) => cells.filter((cell) => cell.customer === name).reduce((sum, cell) => sum + cell.deltaUnits, 0);

  assert.equal(byCustomer('FairPrice'), 100);
  assert.equal(byCustomer('NHG'), 100);
  // FairPrice's 100 follows its own mix: A sells 3x B.
  assert.deepEqual(cells.filter((cell) => cell.customer === 'FairPrice').map((cell) => cell.deltaUnits), [75, 25]);
});

test('one customer in view covers only a block for exactly that customer', () => {
  const view = chartView({ customerName: 'FairPrice' });

  assert.equal(viewCoversItem(block(['FairPrice']), view), true);
  assert.equal(viewCoversItem(block(['FairPrice', 'NHG']), view), false);
  assert.equal(viewCoversItem(block([]), view), false);
});

test('a units block for several customers fetches only the customer in view, when the view cuts it short', () => {
  const units = block(['FairPrice', 'NHG'], { upliftMode: 'units' });

  assert.deepEqual(Object.keys(splitBasisNeeds([units], chartView({ customerName: 'FairPrice', skuRange: 'Pants' }), ROWS)), [
    'FairPrice',
  ]);
  assert.deepEqual(Object.keys(splitBasisNeeds([units], chartView({ skuRange: 'Pants' }), ROWS)).sort(), ['FairPrice', 'NHG']);
});
