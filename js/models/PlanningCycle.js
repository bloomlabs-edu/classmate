/**
 * models/PlanningCycle.js
 *
 * A generic, time-boxed planning window. The engine and service treat
 * this purely as a date range with an identity — "monthly" is a
 * framing a future Setup Wizard UI applies by choosing which dates to
 * pass in, not a property this model itself enforces. The same
 * concept can later support termly, weekly, or custom-length cycles
 * with no change here.
 *
 * Progress fields (`totalLessons`, `completedLessons`,
 * `cancelledLessons`, `completionPercent`) are a lightweight summary,
 * deliberately maintained incrementally rather than recomputed from
 * scanning every Lesson on every read — see
 * services/plannerService.js's recordLessonStatusChange(). A fresh
 * cycle starts at all zeros; generateAndSaveLessons() sets
 * `totalLessons` once, at generation time; nothing in this milestone
 * has a UI path that changes `completedLessons`/`cancelledLessons`
 * yet, but the update mechanism exists now so a future calendar UI has
 * something correct to call rather than inventing its own recompute
 * logic later.
 */

import { generateId } from '../utils/idGenerator.js';

export function createPlanningCycle({
  id,
  classroomId,
  startDate,
  endDate,
  label = null,
  strategyName = 'balanced',
  totalLessons = 0,
  completedLessons = 0,
  cancelledLessons = 0,
  completionPercent = 0,
} = {}) {
  return {
    id: id || generateId(),
    classroomId,
    startDate, // ISO date string, e.g. "2026-10-01"
    endDate, // ISO date string, e.g. "2026-10-31"
    label, // optional display label a future UI sets, e.g. "October 2026"
    strategyName, // default scheduling strategy for this cycle — see services/plannerStrategies/strategyRegistry.js
    totalLessons,
    completedLessons,
    cancelledLessons,
    completionPercent,
  };
}
