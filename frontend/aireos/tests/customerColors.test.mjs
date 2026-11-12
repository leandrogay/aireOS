// Customer colour order: matched to customer records by customer_id, so a
// renamed record keeps its colour. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { customerColor, customerColorOrder } from '../app/utils/storeFormats.js';

// The customer records as GET /api/inventory/customers returns them, renamed.
const RECORDS = [
  { customer_id: 1, customer_name: 'FairPrice' },
  { customer_id: 21, customer_name: 'NHG' },
  { customer_id: 23, customer_name: 'Prime' },
  { customer_id: 16, customer_name: 'Sheng_Shiong' },
  { customer_id: 22, customer_name: 'SingHealth' },
];

// The dashboard's Customer filter options, named from the sales data.
const OPTIONS = [
  { value: 'fairprice', customer_id: 1 },
  { value: 'nhg', customer_id: 21 },
  { value: 'prime', customer_id: 23 },
  { value: 'sheng_siong', customer_id: 16 },
  { value: 'singhealth', customer_id: 22 },
];

describe('customerColorOrder', () => {
  test('names each record by its linked option, in customer_id order, whatever the record is called', () => {
    assert.deepEqual(customerColorOrder(RECORDS, OPTIONS), ['fairprice', 'sheng_siong', 'nhg', 'singhealth', 'prime']);
  });

  test('a renamed customer keeps the colour of its customer_id slot', () => {
    const order = customerColorOrder(RECORDS, OPTIONS);
    assert.equal(customerColor('fairprice', order), '#7A70B8');
  });

  test('an option with no customer record goes after every record', () => {
    const order = customerColorOrder(RECORDS, [...OPTIONS, { value: 'giant', customer_id: null }]);
    assert.equal(order.at(-1), 'giant');
    assert.equal(order.length, 6);
  });

  test('a record no option links to keeps its own name (the inventory page)', () => {
    assert.deepEqual(customerColorOrder(RECORDS), ['FairPrice', 'Sheng_Shiong', 'NHG', 'SingHealth', 'Prime']);
  });
});
