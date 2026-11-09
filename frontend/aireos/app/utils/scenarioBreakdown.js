// Pure breakdown helpers for the Phase 5-9 Scenario Builder draft.

/**
 * Explain one simulated month without changing the existing delta-cell
 * engine. Values are intentionally units only.
 *
 * @param {{ forecast_current?: number, tier0_sell_out_base?: number }} row
 * @param {{ lastYear?: number, growth?: number, blocks?: number, promotions?: number }} contributions
 */
export function breakdownForRow(row, contributions = {}) {
  const model = Number(row?.forecast_current ?? row?.tier0_sell_out_base ?? 0);
  const lastYear = Number(contributions.lastYear ?? row?.tier0_ly_cartons ?? 0);
  const growth = Number(contributions.growth ?? (model - lastYear));
  const blocks = Number(contributions.blocks ?? 0);
  const promotions = Number(contributions.promotions ?? 0);
  return {
    baseline: {
      lastYear,
      growth,
      model,
    },
    scenario: { blocks, promotions },
    simulated: model + blocks + promotions,
    tier0: {
      method: row?.tier0_base_method ?? null,
      runRate: row?.tier0_run_rate ?? null,
      bakedInGrowth: row?.tier0_growth ?? null,
    },
  };
}

export function discountSourceLabel(source) {
  return {
    measured: 'Measured',
    anchor: 'Anchor fallback',
    not_frozen_yet: 'Not frozen yet',
  }[source] ?? source ?? '';
}
