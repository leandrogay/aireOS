'use client';

/**
 * Draft promotions tab of the Scenario builder panel.
 *
 * STUB, owned by the promotions side (blueprint Part 5 and Part 7). It gets
 * the same props as BuildingBlocksSection, so it can be built without
 * touching ScenarioBuilder: edit the draft's promotions through `onChange`,
 * and make them count by filling in app/utils/scenarioPromotions.js.
 *
 * @param {{
 *   items: object[],
 *   onChange: (next: object[] | ((items: object[]) => object[])) => void,
 *   customerOptions: string[],
 *   productOptions: string[],
 *   months: string[],
 *   defaultCustomer: string,
 *   defaultSku: string,
 *   impacts: Map<string, { deltaUnits: number, deltaRevenue: number, months: string[] }>,
 * }} props
 */
export default function PromotionsSection({ items, onChange, impacts }) {
  return (
    <div className="space-y-2 rounded-md border border-dashed border-violet/60 bg-cream/40 px-3 py-4 text-xs text-deep-violet-blue/70">
      <p className="font-medium text-deep-violet-blue">Draft promotions are coming soon.</p>
      <p>
        Plan a promotion here to see its uplift next to your building blocks: pick a mechanic, and the
        expected uplift fills in from the lookup table.
      </p>
    </div>
  );
}
