// Every source the Scenario engine runs (see scenarioEngine.js for the
// contract). Shared file: change it only in a small commit of its own.
import { scenarioBlocksSource, scenarioGrowthSource } from '@/app/utils/scenarioBlocks';
import { scenarioPromotionsSource } from '@/app/utils/scenarioPromotions';
import { scenarioOfficialSource } from '@/app/utils/scenarioTier0Split';

// Official promotions first: they replace what Tier 0 carries, under what the
// scenario adds. Then growth, the bottom layer of what the scenario adds.
export const SCENARIO_SOURCES = [
  scenarioOfficialSource,
  scenarioGrowthSource,
  scenarioBlocksSource,
  scenarioPromotionsSource,
];

/**
 * The source that owns a delta cell or item, by its key.
 *
 * @param {string} key
 */
export function scenarioSource(key) {
  return SCENARIO_SOURCES.find((source) => source.key === key) ?? null;
}
