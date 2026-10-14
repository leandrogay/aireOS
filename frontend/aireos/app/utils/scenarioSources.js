// Every source the Scenario engine runs (see scenarioEngine.js for the
// contract). Shared file: change it only in a small commit of its own.
import { scenarioBlocksSource } from '@/app/utils/scenarioBlocks';
import { scenarioPromotionsSource } from '@/app/utils/scenarioPromotions';

export const SCENARIO_SOURCES = [scenarioBlocksSource, scenarioPromotionsSource];

/**
 * The source that owns a delta cell or item, by its key.
 *
 * @param {string} key
 */
export function scenarioSource(key) {
  return SCENARIO_SOURCES.find((source) => source.key === key) ?? null;
}
