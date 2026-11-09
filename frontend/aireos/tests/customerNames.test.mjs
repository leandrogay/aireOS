// Customer names keep the capitals they were typed with; retailer names stay
// lowercase slugs. Mirrors backend schemas.catalog. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cleanCustomerName, normaliseName, storedName, validateName } from '../app/utils/customerForm.js';
import { customerLabel, retailerLabel, vendorLabel } from '../app/utils/retailerLabel.js';

// ---- How a typed name is stored ----

describe('cleanCustomerName', () => {
  test('keeps the capitals as typed', () => {
    assert.equal(cleanCustomerName('FairPrice'), 'FairPrice');
    assert.equal(cleanCustomerName('NHG'), 'NHG');
  });

  test('turns spaces and hyphens into one underscore', () => {
    assert.equal(cleanCustomerName('  Sheng Shiong  '), 'Sheng_Shiong');
    assert.equal(cleanCustomerName('Cold  Storage'), 'Cold_Storage');
    assert.equal(cleanCustomerName('7-Eleven'), '7_Eleven');
  });
});

describe('storedName', () => {
  test('lowercases a retailer but not a customer', () => {
    assert.equal(storedName('FairPrice Online', 'retailer'), 'fairprice_online');
    assert.equal(storedName('FairPrice Online', 'customer'), 'FairPrice_Online');
    assert.equal(normaliseName('FairPrice Online'), 'fairprice_online');
  });
});

describe('validateName', () => {
  test('a customer name differing only in capitals is taken', () => {
    const taken = new Set(['nhg']);
    assert.equal(validateName('NHG', taken, 'customer'), 'A customer with this name already exists.');
  });

  test('a capitalised customer name is accepted', () => {
    assert.equal(validateName('FairPrice', new Set(['nhg']), 'customer'), '');
  });

  test('symbols are rejected', () => {
    assert.match(validateName('Giant & Co', new Set(), 'customer'), /letters, numbers/);
  });
});

// ---- How a stored name is shown ----

describe('customerLabel', () => {
  test('shows underscores as spaces and keeps the capitals', () => {
    assert.equal(customerLabel('Sheng_Shiong'), 'Sheng Shiong');
    assert.equal(customerLabel('FairPrice'), 'FairPrice');
    assert.equal(customerLabel('NHG'), 'NHG');
    assert.equal(customerLabel(null), '');
  });

  test('a retailer slug is still title-cased by retailerLabel', () => {
    assert.equal(retailerLabel('fairprice_online'), 'Fairprice Online');
  });
});

describe('retailerLabel with its customer', () => {
  test("a customer's channel retailer reads with the customer's name", () => {
    assert.equal(retailerLabel('nhg_offline', 'NHG'), 'NHG Offline');
    assert.equal(retailerLabel('fairprice_online', 'FairPrice'), 'FairPrice Online');
    assert.equal(retailerLabel('sheng_shiong_offline', 'Sheng_Shiong'), 'Sheng Shiong Offline');
  });

  test('a retailer not named after the customer keeps its own label', () => {
    assert.equal(retailerLabel('fairprice_offline', 'NTUC'), 'Fairprice Offline');
    assert.equal(retailerLabel('giant_hyper', 'Giant'), 'Giant Hyper');
  });

  test('passed straight to map, the index is not taken as a customer', () => {
    assert.deepEqual(['nhg_offline', 'fairprice_online'].map(retailerLabel), ['Nhg Offline', 'Fairprice Online']);
  });
});

describe('vendorLabel', () => {
  test('a vendor saved as a customer name keeps its capitals', () => {
    assert.equal(vendorLabel('Sheng_Shiong'), 'Sheng Shiong');
  });

  test('a vendor saved as an old lowercase slug is title-cased', () => {
    assert.equal(vendorLabel('giant'), 'Giant');
  });
});
