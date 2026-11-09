// Every source the Scenario engine runs (see scenarioEngine.js for the
// contract). Shared file: change it only in a small commit of its own.
import { scenarioBlocksSource, scenarioGrowthSource } from '@/app/utils/scenarioBlocks';
import { scenarioPromotionsSource } from '@/app/utils/scenarioPromotions';

// Growth first: it is the bottom layer of what the scenario adds to Tier 0.
export const SCENARIO_SOURCES = [scenarioGrowthSource, scenarioBlocksSource, scenarioPromotionsSource];

/**
 * The source that owns a delta cell or item, by its key.
 *
 * @param {string} key
 */
export function scenarioSource(key) {
  return SCENARIO_SOURCES.find((source) => source.key === key) ?? null;
}
