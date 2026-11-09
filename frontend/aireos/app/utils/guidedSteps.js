// The guided nomenclature review (/nomenclature/[id]) asks one topic per
// screen, Duolingo style, instead of the full review page's four long
// sections. These helpers say which screens a mapping needs, whether the
// reviewer may move on from one, and which screen settles each item of the
// "What's left" list (utils/reviewChecklist). Pure and import-free, so
// `npm test` runs them with Node (tests/guidedSteps.test.mjs).
//
// Every screen reads one `status` object, worked out by the page from the
// mapping and the reviewer's edits:
//   hasCustomer         a customer is chosen
//   retailersDone       the checklist's "Sales go to the customer's retailers"
//   retailerUnconfirmed a low-confidence retailer still waiting on "Looks right"
//   groupCount          column groups in use or offered (period / outlet columns)
//   unconfirmedGroups   group-read fields still waiting on "Looks right"
//   unconfirmedFields   other low-confidence fields still waiting on "Looks right"
//   duplicateCount      fields two columns both fill
//   missingCount        required fields nothing fills
//   rollupRelevant      the file is not plainly monthly, or already rolls up
//   codeCount           product codes in the example file
//   unknownCodeCount    codes that are not a master SKU
//   masterAvailable     the SKU master could be read
//   checksFailed        failing checks (errors only)
//   checksStale         the mapping changed since the checks ran

// In the order they are asked. `label` names a screen in the overview and the
// progress bar; `title` is the question at the top of the screen.
export const GUIDED_STEPS = {
  intro: { label: 'Your file', title: 'Here’s what we read' },
  customer: { label: 'Customer', title: 'Whose file is this?' },
  channel: { label: 'Online or offline', title: 'Where do these sales go?' },
  groups: { label: 'Repeating columns', title: 'Some columns repeat' },
  fields: { label: 'Fields', title: 'Check the fields' },
  missing: { label: 'Missing fields', title: 'Fill in what’s missing' },
  rollup: { label: 'Weekly or monthly', title: 'Keep the rows, or add them up by month?' },
  products: { label: 'Product codes', title: 'Which product is each code?' },
  test: { label: 'Test', title: 'Let’s test it' },
  approve: { label: 'Approve', title: 'Name it and approve' },
};

const ORDER = Object.keys(GUIDED_STEPS);

/** Whether this mapping has anything to ask on a screen. The rest always show. */
export function needsStep(key, status) {
  switch (key) {
    case 'groups':
      return status.groupCount > 0;
    case 'missing':
      return status.missingCount > 0;
    case 'rollup':
      return Boolean(status.rollupRelevant);
    case 'products':
      return status.codeCount > 0 && (status.unknownCodeCount > 0 || !status.masterAvailable);
    default:
      return true;
  }
}

/**
 * The screens to go through, in order: the ones this mapping needs, plus any
 * already visited. A screen that stops being needed while the reviewer is on
 * it (the last missing field filled) stays, so the steps never shift under them.
 *
 * @param {object} status
 * @param {string[]} visited
 * @returns {string[]}
 */
export function guidedSteps(status, visited = []) {
  return ORDER.filter((key) => needsStep(key, status) || visited.includes(key));
}

/** The optional screens this mapping has nothing to ask on, for the overview's "nothing to do". */
export function skippedSteps(status, visited = []) {
  const shown = new Set(guidedSteps(status, visited));
  return ORDER.filter((key) => !shown.has(key));
}

/**
 * Whether Continue is open on a screen: the question on it is answered. The
 * test screen needs a passing run of the current edits; the overview and
 * approve screens have no answer to wait on.
 */
export function canContinue(key, status) {
  switch (key) {
    case 'customer':
      return Boolean(status.hasCustomer);
    case 'channel':
      return Boolean(status.retailersDone) && !status.retailerUnconfirmed;
    case 'groups':
      return status.unconfirmedGroups === 0;
    case 'fields':
      return status.unconfirmedFields === 0 && status.duplicateCount === 0;
    case 'missing':
      return status.missingCount === 0;
    case 'products':
      return Boolean(status.masterAvailable) && status.unknownCodeCount === 0;
    case 'test':
      return status.checksFailed === 0 && !status.checksStale;
    default:
      return true;
  }
}

/** The screen after `key`, or null on the last. */
export function nextStep(key, steps) {
  const index = steps.indexOf(key);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;
}

/** The screen before `key`, or null on the first. */
export function previousStep(key, steps) {
  const index = steps.indexOf(key);
  return index > 0 ? steps[index - 1] : null;
}

// Where each "What's left" item (reviewChecklist ids) is settled.
const ITEM_STEPS = {
  name: 'approve',
  customer: 'customer',
  retailers: 'channel',
  required: 'missing',
  confirm: 'fields',
  duplicates: 'fields',
  products: 'products',
  checks: 'test',
};

/**
 * The screen that settles a "What's left" item. A screen this mapping skips
 * falls back to the fields screen, which reaches every field and the
 * product codes through its editor.
 */
export function stepForItem(itemId, steps) {
  const key = ITEM_STEPS[itemId];
  if (key && steps.includes(key)) return key;
  if (key === 'products') return 'approve'; // the full table sits under "See everything"
  return 'fields';
}

/**
 * The screen that fixes a failing check, from the fields it names (backend
 * mapping_checks `fields`): the product codes for the sku, the missing-fields
 * screen for a required field nothing fills, otherwise the fields.
 *
 * @param {{ fields?: string[] }} check
 * @param {string[]} steps
 * @param {string[]} missingFields
 */
export function stepForCheck(check, steps, missingFields = []) {
  const fields = check.fields || [];
  if (fields.includes('sku') && steps.includes('products')) return 'products';
  if (fields.some((field) => missingFields.includes(field)) && steps.includes('missing')) return 'missing';
  return 'fields';
}
