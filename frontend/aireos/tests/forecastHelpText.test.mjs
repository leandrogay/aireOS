// The Sell-out Forecast page's explanations (app/utils/forecastHelpText.js):
// every key a component uses exists, the panel's sections and links line up,
// and nothing data-dependent is hard-coded. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  HELP,
  HELP_SECTIONS,
  HELP_SECTION_IDS,
  helpSection,
  helpText,
  missingMonthsByCustomer,
  missingMonthsLayout,
  parseHelpSection,
} from '../app/utils/forecastHelpText.js';

const COMPONENT_DIR = new URL('../app/components/forecast/', import.meta.url);
const PAGE = new URL('../app/forecast/page.js', import.meta.url);

function sources() {
  const files = readdirSync(COMPONENT_DIR)
    .filter((name) => name.endsWith('.jsx'))
    .map((name) => readFileSync(new URL(name, COMPONENT_DIR), 'utf8'));
  return [...files, readFileSync(PAGE, 'utf8')];
}

function usedKeys() {
  const keys = new Set();
  for (const source of sources()) {
    for (const match of source.matchAll(/helpKey="(\w+)"/g)) keys.add(match[1]);
  }
  return keys;
}

// ---- Keys ----

describe('help keys', () => {
  test('every key a component uses exists in the content file', () => {
    const keys = usedKeys();
    assert.ok(keys.size >= 10, `expected the page to use help keys, found ${keys.size}`);
    for (const key of keys) {
      assert.ok(HELP[key], `missing help text for "${key}"`);
    }
  });

  test('every entry has text and a "Learn more" section that exists', () => {
    for (const [key, entry] of Object.entries(HELP)) {
      assert.ok(entry.text?.length > 10, `${key} has no text`);
      assert.ok(HELP_SECTION_IDS.includes(entry.section), `${key} points at unknown section ${entry.section}`);
    }
  });

  test('an unknown key fails loudly instead of showing nothing', () => {
    assert.throws(() => helpText('nope'), /Unknown forecast help key: nope/);
  });

  test('a key opens the panel at its own section', () => {
    assert.equal(helpSection('range'), 'accuracy');
    assert.equal(helpSection('missing'), 'missing');
  });

  test('the model text says Initial always comes from Tier 0', () => {
    assert.match(helpText('model'), /Initial Yearly Forecast always comes from Tier 0/);
    assert.doesNotMatch(helpText('model'), /switches the Initial/);
  });

  test('the Pack pills are explained as a promotion filter, not a unit switch', () => {
    assert.match(helpText('packs'), /single packs, on cartons, or both/);
    assert.match(helpText('packs'), /Every quantity on the page is in cartons/);
  });
});

// ---- ?help= ----

describe('?help= opens the panel at a section', () => {
  test('a known section opens there', () => {
    for (const id of HELP_SECTION_IDS) assert.equal(parseHelpSection(id), id);
  });

  test('anything else keeps the panel closed', () => {
    for (const value of [null, '', 'LINES', 'unknown']) assert.equal(parseHelpSection(value), null);
  });

  test('every section has a title and content, in panel order', () => {
    assert.deepEqual(Object.keys(HELP_SECTIONS).sort(), [...HELP_SECTION_IDS].sort());
    for (const id of HELP_SECTION_IDS) {
      assert.ok(HELP_SECTIONS[id].title, `${id} has no title`);
      assert.ok(HELP_SECTIONS[id].blocks.length, `${id} has no content`);
    }
  });
});

// ---- Nothing hard-coded ----

describe('facts that come from the data', () => {
  test('no section names a specific missing month or lock date', () => {
    // The 2027 plan's early lock (12 Nov 2026) is the one dated fact, kept to
    // its own paragraph and FAQ (forecastLineText.EARLY_LOCK_NOTES).
    const text = JSON.stringify(HELP) + JSON.stringify({ ...HELP_SECTIONS, initial: null, faq: null });
    assert.doesNotMatch(text, /NHG January 2026|SingHealth May 2026|12 Nov 2026|31 Dec/);
  });

  test('missing months are labelled per customer, customers A-Z and months oldest first', () => {
    const customers = [
      { customer_id: 9, customer_name: 'singhealth', months: ['2026-05-01'] },
      { customer_id: 7, customer_name: 'nhg', months: ['2026-03-01', '2026-01-01'] },
      { customer_id: 3, customer_name: 'fairprice', months: [] },
    ];
    const label = (name) => ({ nhg: 'NHG', singhealth: 'SingHealth' })[name] ?? name;

    assert.deepEqual(missingMonthsByCustomer(customers, label), [
      { key: '7', name: 'NHG', months: ['Jan 2026', 'Mar 2026'] },
      { key: '9', name: 'SingHealth', months: ['May 2026'] },
    ]);
    assert.deepEqual(missingMonthsByCustomer([], label), []);
  });

  test('nothing missing draws no list', () => {
    assert.equal(missingMonthsLayout([]), 'none');
  });

  test('one customer, or several missing one month each, are cards', () => {
    assert.equal(missingMonthsLayout([{ months: ['Jan 2026', 'Mar 2026'] }]), 'cards');
    assert.equal(missingMonthsLayout([{ months: ['Jan 2026'] }, { months: ['May 2026'] }]), 'cards');
  });

  test('several customers with one of them missing several months is a table', () => {
    assert.equal(missingMonthsLayout([{ months: ['Jan 2026', 'Mar 2026'] }, { months: ['May 2026'] }]), 'table');
  });
});
