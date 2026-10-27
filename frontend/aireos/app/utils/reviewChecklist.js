import { retailerLabel } from '@/app/utils/retailerLabel';
import { fieldLabel } from '@/app/utils/mappingReview';

// The review screen's "What's left" list: every condition an approval waits
// on, in the order the page asks for it, each pointing at the section that
// settles it. One list, so a problem is told once instead of in a banner, a
// card and a footer. The backend confirm endpoint enforces the same
// conditions (backend routers/mappings.confirm_mapping); this is the screen
// saying so before the click rather than after it.

// Section anchors, shared with the sections that carry them.
export const SECTION_IDS = {
  customer: 'review-customer',
  fields: 'review-fields',
  products: 'review-products',
  checks: 'review-checks',
};

function plural(count, one, many) {
  return count === 1 ? one : many;
}

/**
 * @param {{
 *   name: string,
 *   customer: object | null,
 *   outputs: string[] | null,
 *   statuses: { name: string, status: string }[],
 *   issues: ReturnType<import('./mappingReview').reviewIssues>,
 *   codes: object[],
 *   unknownCodes: string[],
 *   masterAvailable: boolean,
 *   checks: { failed: number, stale: boolean },
 * }} state
 * @returns {{ id: string, label: string, done: boolean, detail: string, href: string }[]}
 */
export function reviewChecklist({ name, customer, outputs, statuses, issues, codes, unknownCodes, masterAvailable, checks }) {
  const items = [];
  const customerHref = `#${SECTION_IDS.customer}`;
  const fieldsHref = `#${SECTION_IDS.fields}`;

  items.push({
    id: 'name',
    label: 'Name the mapping',
    done: Boolean(name.trim()),
    detail: '',
    href: customerHref,
  });

  items.push({
    id: 'customer',
    label: 'Choose the customer',
    done: Boolean(customer),
    detail: '',
    href: customerHref,
  });

  const unsettled = statuses.filter((item) => item.status !== 'ok');
  let retailerDetail = '';
  if (!customer) retailerDetail = 'Choose the customer first.';
  else if (outputs && !outputs.length) retailerDetail = 'Nothing sets the retailer yet.';
  else if (unsettled.length) {
    retailerDetail = `${unsettled.map((item) => item.name).join(', ')} ${plural(unsettled.length, 'is not a retailer', 'are not retailers')} of ${retailerLabel(customer.customer_name)}.`;
  } else if (!outputs) retailerDetail = 'Checked against the whole file when you approve.';
  items.push({
    id: 'retailers',
    label: "Sales go to the customer's retailers",
    done: Boolean(customer) && !(outputs && !outputs.length) && !unsettled.length,
    detail: retailerDetail,
    href: customerHref,
  });

  const missing = issues.missingRequired;
  items.push({
    id: 'required',
    label: 'Every required field has a source',
    done: !missing.length,
    detail: missing.length ? `Missing: ${missing.map((entry) => entry.label).join(', ')}.` : '',
    href: fieldsHref,
  });

  if (issues.guessed) {
    const left = issues.unconfirmed.length;
    items.push({
      id: 'confirm',
      label: `Confirm the low-confidence fields (${issues.guessed - left}/${issues.guessed})`,
      done: !left,
      detail: left ? issues.unconfirmed.map((entry) => entry.label).join(', ') : '',
      href: fieldsHref,
    });
  }

  if (issues.duplicateTargets.length) {
    items.push({
      id: 'duplicates',
      label: 'One column per field',
      done: false,
      detail: `Two columns both fill ${issues.duplicateTargets.map(fieldLabel).join(', ')}.`,
      href: fieldsHref,
    });
  }

  if (codes.length) {
    let detail = '';
    if (!masterAvailable) detail = 'The SKU master could not be read, so the codes cannot be checked right now.';
    else if (unknownCodes.length) detail = `${unknownCodes.length} ${plural(unknownCodes.length, 'code is', 'codes are')} not a master SKU.`;
    items.push({
      id: 'products',
      label: 'Every product code is a master SKU',
      done: masterAvailable && !unknownCodes.length,
      detail,
      href: `#${SECTION_IDS.products}`,
    });
  }

  let checksDetail = '';
  if (checks.failed && checks.stale) checksDetail = 'Run them again after your changes.';
  else if (checks.failed) checksDetail = `${checks.failed} failing`;
  else if (checks.stale) checksDetail = 'You changed the mapping since they ran; approving runs them again.';
  items.push({
    id: 'checks',
    label: 'Checks pass on the example file',
    done: !checks.failed,
    detail: checksDetail,
    href: `#${SECTION_IDS.checks}`,
  });

  return items;
}
