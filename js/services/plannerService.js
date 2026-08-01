/**
 * services/plannerService.js
 *
 * Orchestrates the Planner domain: creating PlanningCycles, calling
 * the pure engine to generate Lessons, persisting the results, and
 * maintaining each PlanningCycle's lightweight progress summary. The
 * engine (services/plannerEngine.js) never talks to
 * services/plannerRepository.js or services/workspaceService.js
 * directly — this file is the only place "compute a schedule" and
 * "persist it" meet, matching the same Services-layer role every
 * other domain in this app follows (see e.g.
 * services/assessmentService.js, services/curriculumLinkingService.js).
 *
 * A plain namespace-style module (`import * as plannerService`), not
 * a class — matching every other service in this app. PlanningCycles
 * are mutated directly on the classroom object and persisted via
 * services/workspaceService.js's save(), the same pattern
 * services/assessmentService.js already uses for
 * classroom.assessments; Lessons are persisted separately, through
 * services/plannerRepository.js's own Firestore subcollection (see
 * that file's own header comment for why).
 */

import { createPlanningCycle } from '../models/PlanningCycle.js';
import { generateLessons } from './plannerEngine.js';
import * as plannerRepository from './plannerRepository.js';
import * as workspaceService from './workspaceService.js';

function ensurePlanner(classroom) {
  if (!classroom.planner) classroom.planner = { planningCycles: [] };
  if (!classroom.planner.planningCycles) classroom.planner.planningCycles = [];
  return classroom.planner;
}

/** Every PlanningCycle for this classroom, most recently created first. */
export function getPlanningCycles(classroom) {
  return [...ensurePlanner(classroom).planningCycles].reverse();
}

export function getPlanningCycleById(classroom, planningCycleId) {
  return ensurePlanner(classroom).planningCycles.find((cycle) => cycle.id === planningCycleId) || null;
}

/**
 * Creates and persists a new PlanningCycle in one step — lives on the
 * classroom document itself, so this only needs
 * services/workspaceService.js's save(), no Firestore code of its
 * own. Starts with all progress fields at zero; generateAndSaveLessons()
 * below is what first sets `totalLessons` once real Lessons exist.
 */
export function createNewPlanningCycle(classroom, { classroomId, startDate, endDate, label, strategyName }) {
  const cycle = createPlanningCycle({ classroomId: classroomId || classroom.id, startDate, endDate, label, strategyName });
  ensurePlanner(classroom).planningCycles.push(cycle);
  workspaceService.save(classroom);
  return cycle;
}

/**
 * Runs the engine and persists what it returns — the one place
 * "compute a schedule" and "save it" meet. `teachingSlots` is
 * filtered to the requested `subjectId` here, before the engine ever
 * sees it, so the engine itself never needs to know what a subjectId
 * even is; filtering by the PlanningCycle's own date range still
 * happens inside the strategy, since that's intrinsic to what a
 * planning cycle means, not a caller-supplied concern (see
 * services/plannerStrategies/balancedStrategy.js's own header
 * comment).
 */
export async function generateAndSaveLessons({ classroom, planningCycle, teachingSlots, curriculumUnits, subjectId, strategyName }) {
  const relevantSlots = subjectId ? teachingSlots.filter((slot) => slot.subjectId === subjectId) : teachingSlots;

  const lessons = generateLessons({ teachingSlots: relevantSlots, planningCycle, curriculumUnits, strategyName });

  await plannerRepository.saveLessons(classroom.id, lessons);

  planningCycle.totalLessons = lessons.length;
  planningCycle.completedLessons = 0;
  planningCycle.cancelledLessons = 0;
  planningCycle.completionPercent = 0;
  workspaceService.save(classroom);

  return lessons;
}

export async function getLessonsForCycle(classroom, planningCycleId) {
  return plannerRepository.getLessonsForCycle(classroom.id, planningCycleId);
}

/**
 * Updates a PlanningCycle's progress summary incrementally — a single
 * status transition's worth of adjustment, not a full rescan of every
 * Lesson in the cycle. 'taught' counts toward `completedLessons`;
 * 'skipped' counts toward `cancelledLessons`; 'planned' and
 * 'rescheduled' count toward neither (a rescheduled lesson is
 * expected to still happen, just on a different slot — its old
 * instance isn't a cancellation). No UI calls this yet in this
 * milestone (no calendar, no status controls) — it exists now so a
 * future one has correct, ready-made logic to call rather than
 * inventing its own recompute-from-scratch approach later.
 */
export function recordLessonStatusChange(planningCycle, previousStatus, newStatus) {
  if (previousStatus === newStatus) return;

  if (previousStatus === 'taught') planningCycle.completedLessons--;
  if (previousStatus === 'skipped') planningCycle.cancelledLessons--;
  if (newStatus === 'taught') planningCycle.completedLessons++;
  if (newStatus === 'skipped') planningCycle.cancelledLessons++;

  planningCycle.completionPercent =
    planningCycle.totalLessons > 0 ? Math.round((planningCycle.completedLessons / planningCycle.totalLessons) * 100) : 0;
}

/** Changes one Lesson's status, updates its owning PlanningCycle's progress summary to match, and persists both. */
export async function updateLessonStatus(classroom, planningCycle, lesson, newStatus) {
  const previousStatus = lesson.status;
  lesson.status = newStatus;
  recordLessonStatusChange(planningCycle, previousStatus, newStatus);

  await plannerRepository.saveLesson(classroom.id, lesson);
  workspaceService.save(classroom);

  return lesson;
}
