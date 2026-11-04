// The order the team works in each month, shown beside the hero so a new user
// sees how the sections fit together before choosing one. The numbering is
// real: each step needs the one before it (the dashboard only shows uploaded
// data, and a new layout needs its mapping confirmed before it loads).
const STEPS = [
  {
    title: 'Upload sell-out files',
    body: "Drop a retailer's weekly or monthly export. Layouts seen before load straight in.",
  },
  {
    title: 'Confirm new layouts',
    body: 'A file with new columns gets an AI-proposed nomenclature that you review once.',
  },
  {
    title: 'Read the numbers',
    body: 'Sales by customer, store format and SKU, compared with any earlier period.',
  },
  {
    title: 'Plan ahead',
    body: 'Check the forecast, schedule promotions and see which SKUs fall below their days-of-holding target.',
  },
];

export default function MonthlyCycle() {
  return (
    <section
      aria-labelledby="monthly-cycle-heading"
      className="rounded-lg border border-lavander bg-white p-5 shadow-sm"
    >
      <h2 id="monthly-cycle-heading" className="text-sm font-medium text-deep-violet-blue">
        The monthly cycle
      </h2>
      <ol className="mt-4 space-y-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-deep-violet-blue font-mono text-xs font-medium text-white"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-deep-violet-blue">{step.title}</p>
              <p className="mt-0.5 text-sm text-deep-violet-blue/70">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
