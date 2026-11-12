// Every explanation on the Sell-out Forecast page: the ⓘ popovers (HELP, by
// key) and the "How this forecast works" panel (HELP_SECTIONS). Written for
// planners, not developers. Components never hard-code this text: they name a
// key (<ForecastInfo helpKey="model" />), and tests/forecastHelpText.test.mjs
// fails if a key a component uses is missing here.
//
// Nothing here states a fact that changes with the data. Months a customer
// hasn't sent come from the backend (missingMonthsByCustomer); the line
// wording that names a month lives in forecastLineText.js. Pure and import-light so `npm test` can run it.

import {
  EARLY_LOCK_NOTES,
  FORECAST_UPDATING_HINT,
  INITIAL_BUILD_DAY,
  INITIAL_LOCK_DAY,
  PAST_ACCURACY_BADGE_HINT,
  TABLE_PARTIAL_HINT,
  TIER0_HINT,
  TIER1_ADVANCED_HINT,
  TIER1_BASIC_HINT,
  dataMonthLabel,
} from './forecastLineText.js';

// Help panel sections, in the order the panel shows them. `?help=<id>` opens
// the panel at one.
export const HELP_SECTION_IDS = [
  'overview',
  'models',
  'updates',
  'data',
  'checks',
  'accuracy',
  'lines',
  'initial',
  'missing',
  'faq',
  'glossary',
];

// ============================================================
// ⓘ POPOVERS (key → { text, section })
// `section` is where its "Learn more" opens the panel.
// ============================================================

export const HELP = {
  // ---- Filters ----
  filterSku: {
    text: 'Pick one product, or All SKUs to add them up. Totals add up the SKUs that have a forecast for the chosen model.',
    section: 'overview',
  },
  filterCustomer: {
    text:
      'The retailer or hospital group whose sell-out (their sales to shoppers or patients) is forecast. Each customer ' +
      'has its own forecast because each sends its sales file on its own schedule.',
    section: 'data',
  },
  model: {
    text:
      'Three ways of forecasting the same sales. Pick the one you plan with; we don\'t choose a "best" one for you. ' +
      'Switching the model switches the Previous forecast and Current forecast lines; the Initial Yearly Forecast always comes from Tier 0 ' +
      "(or, once Aire locks one, from Aire's budget built on it).",
    section: 'models',
  },
  dateRange: {
    text:
      "The months shown on the chart and in the table. The forecast itself always covers the next 12 months after each " +
      "customer's latest sales month.",
    section: 'overview',
  },

  // ---- Model options ----
  tier0: { text: TIER0_HINT, section: 'models' },
  tier1Basic: { text: TIER1_BASIC_HINT, section: 'models' },
  tier1Advanced: { text: TIER1_ADVANCED_HINT, section: 'models' },

  // ---- Chart ----
  range: {
    text:
      'The 80% range: about 8 times out of 10, actual sales should land inside it. Wider means less certain, and it ' +
      'usually widens further ahead.',
    section: 'accuracy',
  },
  monthConfidence: {
    text:
      "How tight this month's range is: High if the range is within ±20% of the forecast, Medium within ±50%, Low " +
      'wider than that.',
    section: 'accuracy',
  },
  accuracy: { text: PAST_ACCURACY_BADGE_HINT, section: 'accuracy' },
  typicalPromo: {
    text:
      "This month's promotion is a type this product hasn't run often enough to learn from, so the model used the " +
      "product's usual promotion pattern for this month instead.",
    section: 'models',
  },
  missing: {
    text:
      "Actual: missing. The customer didn't send a sales file for this month. It's left as a gap (the line is joined " +
      'across it), not counted as 0.',
    section: 'missing',
  },
  notYet: {
    text: 'No sales file for this month yet.',
    section: 'missing',
  },

  // ---- Under the chart ----
  lastUpdated: {
    text:
      'When the forecast last retrained. It updates by itself a few minutes after a sales file is uploaded or a ' +
      'promotion is created, edited or deleted, but only if that changed something the models use.',
    section: 'updates',
  },
  salesDate: {
    text:
      "When this customer's sales were last uploaded to AireOS. This is the upload time, not the latest sales month. " +
      'With All customers, the most recent across them.',
    section: 'data',
  },
  updating: { text: FORECAST_UPDATING_HINT, section: 'updates' },
  initialStatus: {
    text:
      `"Updating until ${INITIAL_LOCK_DAY}": the plan still takes in new sales and promotion changes; after that ` +
      "it's fixed. \"Fixed plan\": the plan is locked, with the month of sales it used, and won't change. " +
      `"Made from ${INITIAL_BUILD_DAY}": next year's plan isn't made yet, so only this year's plan is shown. ` +
      'Once Aire locks a budget on top of a plan, the line shows that budget instead.',
    section: 'initial',
  },

  // ---- Overlay buttons ----
  overlay: {
    text:
      'Shows promotions on the chart by type, so you can see which months had or will have a promotion. Combined ' +
      'with the Pack / Carton choice.',
    section: 'overview',
  },
  packs: {
    text: 'Shades promotions run on single packs, on cartons, or both. Every quantity on the page is in cartons.',
    section: 'overview',
  },

  // ---- Tables ----
  yearRow: {
    text:
      "The year's total: actual sales for the months already reported, plus the Current forecast for the months " +
      'still to come. "Part actual" months: some customers have reported, so those use actuals and the rest use ' +
      'the forecast.',
    section: 'overview',
  },
  yearColumns: {
    text:
      "Actual = reported months; Forecast = remaining months from the selected model's Current forecast line; Total = both.",
    section: 'overview',
  },
  next12: {
    text: 'The sum of the Current forecast for the next 12 months.',
    section: 'overview',
  },
  partial: { text: TABLE_PARTIAL_HINT, section: 'missing' },
};

/** The ⓘ text for a key; throws on an unknown key so a typo fails loudly. */
export function helpText(key) {
  const entry = HELP[key];
  if (!entry) throw new Error(`Unknown forecast help key: ${key}`);
  return entry.text;
}

/** The panel section a key's "Learn more" opens. */
export function helpSection(key) {
  return HELP[key]?.section ?? HELP_SECTION_IDS[0];
}

/** A ?help= value as a known section id, else null (panel closed). */
export function parseHelpSection(value) {
  return HELP_SECTION_IDS.includes(value) ? value : null;
}

// ============================================================
// FROM THE DATA (never hard-coded)
// ============================================================

// The help panel's "Missing months" list, from GET /api/forecast/missing-months
// (all customers, all history: backend forecast_service.get_missing_months).
export const MISSING_MONTHS_TITLE = 'Sales files not sent';
export const MISSING_MONTHS_NONE = 'Every customer has sent every month so far.';
export const MISSING_MONTHS_UNAVAILABLE = "The list of missing months couldn't load. Try reopening this panel.";

/**
 * Each customer's missing months as labels, customers A-Z and months oldest
 * first: [{ key, name, months: ['Jan 2026', 'Mar 2026'] }]. A customer with
 * none is left out.
 *
 * @param {{ customer_id: number, customer_name: string, months: string[] }[]} customers
 * @param {(name: string) => string} [formatCustomer] customerLabel
 */
export function missingMonthsByCustomer(customers, formatCustomer = (name) => name) {
  return (customers ?? [])
    .filter((customer) => customer.months?.length)
    .map((customer) => ({
      key: String(customer.customer_id ?? customer.customer_name),
      name: formatCustomer(customer.customer_name ?? ''),
      months: [...customer.months].sort().map(dataMonthLabel),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How the list is drawn: 'none' when nothing is missing, 'table' when
 * several customers are missing and at least one of them more than one month
 * (one row each reads better than a stack of cards), else 'cards' (one card
 * per customer).
 *
 * @param {ReturnType<typeof missingMonthsByCustomer>} entries
 * @returns {'none' | 'cards' | 'table'}
 */
export function missingMonthsLayout(entries) {
  if (!entries.length) return 'none';
  const manyMonths = entries.some((entry) => entry.months.length > 1);
  return entries.length > 1 && manyMonths ? 'table' : 'cards';
}

// ============================================================
// "HOW THIS FORECAST WORKS" PANEL
// Each section: title, then blocks of { p } (a paragraph), { list } (bullets)
// or { diagram } (drawn by ForecastHelpDiagrams). Dynamic lines are added by
// the panel itself (missing months).
// ============================================================

export const UPDATE_FLOW_STEPS = [
  'Save in the app',
  'Wait 5 minutes for more changes',
  'Did anything the models use change?',
  'Data checks',
  'Retrain all three models',
  'Test their accuracy',
  'Final checks',
  'Page updated',
  'Bell',
];

export const INITIAL_TIMELINE_STEPS = [
  INITIAL_BUILD_DAY,
  'Plan made from the latest sales',
  'Updated with new sales (up to September) and promotion changes',
  `Locked at the end of ${INITIAL_LOCK_DAY}`,
  'Any time after: Aire can lock a budget on top of it, and the line shows that budget',
];

export const HELP_SECTIONS = {
  overview: {
    title: "What you're looking at",
    blocks: [
      {
        p:
          'Four lines per model: Actual (what sold), Initial (the year\'s plan), Previous forecast (the forecast ' +
          'with one month less data) and Current forecast (the latest forecast). Each month\'s 80% range is in the ' +
          'hover card. The Model dropdown switches the Previous forecast and Current forecast; the Initial Yearly Forecast is always the Tier 0 plan, or Aire\'s locked budget built on it. Everything ' +
          'is monthly sell-out in cartons, per customer and product.',
      },
    ],
  },
  models: {
    title: 'The three models',
    blocks: [
      { list: [`Tier 0 · Baseline: ${TIER0_HINT}`, `Tier 1 · Basic: ${TIER1_BASIC_HINT}`, `Tier 1 · Advanced: ${TIER1_ADVANCED_HINT}`] },
      {
        p:
          'All three forecast 15 months ahead; the page shows 12. We don\'t ' +
          'pick a winner: each is shown on its own, with its accuracy, so you can plan with the one you trust. The ' +
          'yearly plan (Initial) is made with Tier 0 only, and Aire\'s budget is built on that plan.',
      },
    ],
  },
  updates: {
    title: 'When the forecast updates',
    blocks: [
      { diagram: 'updateFlow' },
      {
        list: [
          'What triggers it: uploading a sales file; creating, editing or deleting a promotion; archiving or restoring ' +
            'a product. Several saves within 5 minutes give one update.',
          "What doesn't: inventory, customer details, uplift settings or Scenario builder drafts, and promotions more " +
            'than 15 months ahead.',
          "If nothing changed (e.g. only a promotion's discount % changed, or the same file was uploaded again), it " +
            'checks and stops, with no update and no bell.',
          'Every update rebuilds the models from scratch on the full history; nothing is carried over. Only one ' +
            'update runs at a time.',
          'A change made outside the app (e.g. a database restore) needs our team to start an update by hand.',
        ],
      },
    ],
  },
  data: {
    title: 'What it learns from',
    blocks: [
      {
        list: [
          'Monthly sell-out in cartons per customer and product, from January 2025, completed months only, active ' +
            'products only.',
          "Each customer's history ends at its own latest file, so customers that send files at different times " +
            "don't create false zeros.",
          "A product with no sales in a month the customer sent counts as 0. A month the customer hasn't sent is a " +
            'gap, never 0. The models bridge gaps (Tier 1 fills them in from the months either side; Tier 0 averages ' +
            'the months that are there).',
          'Promotions: each month\'s promotion type (e.g. "20% off", "Buy 2 get 1 free", or none) from the app\'s ' +
            'promotion calendar, including planned future promotions. Only Tier 1 Advanced uses them.',
        ],
      },
    ],
  },
  checks: {
    title: 'Checks',
    blocks: [
      {
        p:
          'Before training, only empty or negative quantities, or broken promotion links, stop an update. Other ' +
          "things are warnings that don't block it: a month well below the customer's last 3, a month the customer " +
          "hasn't sent, a new promotion type, an unfamiliar promotion ahead. After training it checks that every " +
          "model was scored, Tier 0 covers every product, no forecast is negative and this year's plan exists. If " +
          'any hard check fails, the page keeps the last good forecast and the team is alerted.',
      },
    ],
  },
  accuracy: {
    title: 'How accurate it is',
    blocks: [
      { list: [HELP.accuracy.text, HELP.monthConfidence.text, HELP.range.text] },
      {
        p:
          "Tier 1's 80% range comes from the model itself; Tier 0's comes from its own past misses at the same " +
          'distance ahead, and never gets narrower further out.',
      },
    ],
  },
  lines: {
    title: 'Previous forecast and Current forecast',
    blocks: [
      {
        p:
          'For each product, the Current forecast is made with sales up to its latest month; the Previous forecast ' +
          'is the same model rebuilt in the same update with one month less. So if a customer\'s latest month is ' +
          'October, the Current forecast starts in November (made with sales to October) and the Previous forecast ' +
          "starts in October (made with sales to September), and you can see how October's sales moved the " +
          'forecast. A brand-new product has no Previous forecast until its second month of sales.',
      },
    ],
  },
  initial: {
    title: 'The yearly plan (Initial)',
    blocks: [
      { diagram: 'initialTimeline' },
      {
        p:
          'Each plan is one calendar year: 12 months, January to December of next year. To cover all of next ' +
          'year, the plan looks up to 18 months ahead, further than the 15 months the other forecasts use, and ' +
          'keeps only those 12 months.',
      },
      {
        list: [
          'Why lock it? So everyone plans against the same numbers for the whole year, and we can measure how ' +
            'close the year comes to the plan.',
          'Which model: Tier 0 for every product, whichever model is selected.',
          'New products: a product that starts selling before the lock joins the plan. A product that starts ' +
            'selling after September has no plan that year, and the page says so.',
          `Promotions: enter next year's promotions before ${INITIAL_LOCK_DAY} so the plan includes them. ` +
            'Promotions added after the lock show up in the Current forecast, but not in the plan.',
          `If no plan appears by 1 Nov, nobody saved anything in the app between ${INITIAL_BUILD_DAY} and ` +
            `${INITIAL_LOCK_DAY}, so the plan was never built. Our team can build it by hand.`,
        ],
      },
      { p: `The 2027 plan: ${EARLY_LOCK_NOTES[2027]}` },
      {
        p:
          "Aire's budget: in the Scenario builder's Budget planning mode, Aire can add building blocks and " +
          "promotions on top of next year's plan and lock the result as the budget with the Lock budget button. " +
          'Once a budget is locked, the Initial Yearly Forecast line shows the budget instead of the plan, on this ' +
          'page and on the Inventory page. Only Aire locks a budget; locking again saves a new version, and the ' +
          'newest version is the one shown.',
      },
    ],
  },
  missing: {
    title: 'Missing months and late files',
    blocks: [
      { list: [HELP.missing.text, HELP.partial.text] },
      {
        p:
          'A customer that sends a later month first is fine: the missing month stays a gap until its file arrives, ' +
          'then the next update fills it in.',
      },
    ],
  },
  faq: {
    title: 'Common questions',
    blocks: [
      {
        qa: [
          [
            'Why did my forecast change?',
            'New sales, a revised file, a promotion change, or a file rolled back. Each one retrains the models.',
          ],
          [
            "Why doesn't the plan change when I upload October sales?",
            `It locked on ${INITIAL_LOCK_DAY} and only uses sales up to September. October sales update the ` +
              'Current forecast instead.',
          ],
          [
            'Why is the 2027 plan different from the Current forecast?',
            'The plan was fixed using the sales of early November 2026. The Current forecast keeps learning from ' +
              'every new month. The gap between them shows how far reality has moved from the plan.',
          ],
          [
            'Why did the Initial Yearly Forecast line change after it locked?',
            'Aire locked a budget, or a new version of it. The line then shows the budget: the yearly plan plus the ' +
              'building blocks and promotions added on top in the Scenario builder.',
          ],
          [
            'Why is Tier 1 Advanced greyed out?',
            "It needs 12 months of sales and a promotion ahead of a type the product has run at least 3 times. The " +
              'greyed-out option says which one is missing.',
          ],
          [
            'Why does a month say Missing instead of 0?',
            "The customer hasn't sent that month's file. It stays a gap until the file arrives, so it can't drag the " +
              'forecast down as a false 0.',
          ],
          [
            'I uploaded a file; when does the forecast update?',
            'About 10–15 minutes after the last change, if it changed something the models use. The bell tells you ' +
              "when it's done.",
          ],
          [
            'Why is the Tier 0 line flat for some customers?',
            "Where there's no same month last year, Tier 0 is the average of the last 3 months alone, so it stays flat.",
          ],
          [
            'Why is there no Previous forecast line?',
            'The Previous forecast needs one month less data than the Current forecast, so a product needs two months of sales (and enough ' +
              'history for the chosen model).',
          ],
          [
            'Which model should I use?',
            'The one you trust for that product: compare their past accuracy. Tier 1 Advanced is the only one that ' +
              'reacts to planned promotions.',
          ],
        ],
      },
    ],
  },
  glossary: {
    title: 'Glossary',
    blocks: [
      {
        qa: [
          ['Sell-out', "The customer's sales to shoppers or patients, in cartons."],
          ['Tier 0', 'The simple baseline from last year and the last 3 months; also the model the yearly plan uses.'],
          ['Tier 1 Basic', "A time-series model of each product's trend and seasons."],
          ['Tier 1 Advanced', 'Tier 1 Basic plus the promotion calendar.'],
          ['Initial', "The yearly plan, from Tier 0, fixed once it locks; shows Aire's locked budget once there is one."],
          ['Budget', "Next year's plan plus the building blocks and promotions Aire adds on top, locked by Aire."],
          ['Previous forecast', 'The same model with one month less sales data.'],
          ['Current forecast', 'The latest forecast.'],
          ['Made with sales up to', 'The last month of sales a forecast learned from.'],
          ['80% range', 'Where actual sales should land about 8 times out of 10.'],
          ['sMAPE', 'Average % error, counting over- and under-forecasts alike.'],
          ['Backtest', "Testing a model on recent months it wasn't allowed to see."],
          ['Retrain', 'Rebuilding the models on the latest data.'],
          ['Promotion type', 'The kind of offer in a month, e.g. "20% off".'],
          ['Familiar promotion', 'A promotion type a product has run at least 3 times before.'],
          ['Missing file', "A month the customer hasn't sent; shown as Missing, never 0."],
          ['Partial total', "A month's total that leaves out a customer still to send its file."],
        ],
      },
    ],
  },
};
