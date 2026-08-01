/**
 * services/plannerStrategies/strategyRegistry.js
 *
 * Maps a strategy name to a pure strategy function. This is the whole
 * mechanism for supporting future scheduling strategies: adding
 * Front-loaded or Revision-heavy later means writing one new file and
 * adding one line here — services/plannerEngine.js and
 * services/plannerService.js never change. Matches the same
 * "one file, one registry line" extension pattern already used
 * elsewhere in this app (e.g. config/assessmentTypesConfig.js's
 * fixed list, resourceTypeConfig.js).
 *
 * Strategy function contract:
 *   ({ teachingSlots, planningCycle, curriculumUnits }) => Lesson[]
 */

import { balancedStrategy } from './balancedStrategy.js';

const strategies = {
  balanced: balancedStrategy,
  // frontLoaded: frontLoadedStrategy,      // future milestone
  // revisionHeavy: revisionHeavyStrategy,  // future milestone
};

export function getStrategy(strategyName) {
  const strategy = strategies[strategyName];
  if (!strategy) {
    const available = Object.keys(strategies).join(', ');
    throw new Error(`Unknown scheduling strategy "${strategyName}". Available: ${available}`);
  }
  return strategy;
}

export function registerStrategy(name, strategyFn) {
  strategies[name] = strategyFn;
}
