/**
 * services/plannerEngine.js
 *
 * Pure, framework-agnostic entry point for lesson generation. Given
 * Teaching Slots, a Planning Cycle, and the curriculum units selected
 * for it, returns an array of scheduled Lesson objects.
 *
 * No Firebase, no DOM, no side effects of any kind — safe to unit
 * test with plain fixtures, and safe to reuse anywhere (a future
 * "preview my cycle" screen, automated tests) without touching
 * persistence at all. services/plannerService.js is the only thing
 * that calls this and then persists what it returns; this file itself
 * never knows persistence exists.
 *
 * @param {object} input
 * @param {object[]} input.teachingSlots - see models/TeachingSlot.js
 * @param {object} input.planningCycle - see models/PlanningCycle.js
 * @param {object[]} input.curriculumUnits
 * @param {string} [input.strategyName] - overrides planningCycle.strategyName if provided
 * @returns {import('../models/Lesson.js').Lesson[]}
 */

import { getStrategy } from './plannerStrategies/strategyRegistry.js';

export function generateLessons({ teachingSlots, planningCycle, curriculumUnits, strategyName }) {
  if (!Array.isArray(teachingSlots)) {
    throw new Error('generateLessons requires a teachingSlots array');
  }
  if (!planningCycle) {
    throw new Error('generateLessons requires a planningCycle');
  }
  if (!Array.isArray(curriculumUnits) || curriculumUnits.length === 0) {
    throw new Error('generateLessons requires at least one selected curriculum unit');
  }

  const strategy = getStrategy(strategyName || planningCycle.strategyName || 'balanced');
  return strategy({ teachingSlots, planningCycle, curriculumUnits });
}
