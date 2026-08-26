/**
 * services/carryForwardService.js
 *
 * Orchestrates moving one unexecuted planned concept from its
 * original Lesson to a future same-subject Teaching Slot's Lesson —
 * "Move to next Science period" from the approved reference. The
 * actual concept move (never cloning, always preserving provenance)
 * is models/Lesson.js's own carryForwardConcept(), which this file
 * only calls; its own job is finding where "the next Science period"
 * actually is (via services/timetableService.js) and persisting both
 * Lessons afterward.
 */

import { createLesson, carryForwardConcept } from '../models/Lesson.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import * as timetableService from './timetableService.js';
import * as plannerRepository from './plannerRepository.js';

export const suggestCarryForwardTargets = timetableService.suggestCarryForwardTargets;

/**
 * Moves `conceptId` off `sourceLesson` onto whichever Lesson is
 * already attached to `targetTeachingSlotId` — creating a brand-new
 * Lesson there first if none exists yet (a teacher can carry a
 * concept into a period with no lesson plan attached at all; the
 * carried concept becomes that period's first content). Caller
 * resolves `existingTargetLesson` first via
 * plannerRepository.getLessonByTeachingSlotId() — kept as an explicit
 * parameter rather than looked up in here, so this function has
 * exactly one job (the move + the atomic persist), not a hidden read
 * before it.
 *
 * Persists both Lessons in one atomic batch
 * (plannerRepository.saveLessons()) so a partial move — the concept
 * vanishing from Tuesday without ever landing on Thursday — can't
 * happen.
 */
export async function carryForwardToTeachingSlot(classroom, { sourceLesson, conceptId, targetTeachingSlotId, targetDate, existingTargetLesson = null }) {
  const targetLesson =
    existingTargetLesson ||
    createLesson({
      classroomId: classroom.id,
      date: targetDate,
      teachingSlotId: targetTeachingSlotId,
      curriculumUnitId: sourceLesson.curriculumUnitId,
    });

  carryForwardConcept({
    sourceLesson,
    targetLesson,
    conceptId,
    sourceTeachingSlotId: sourceLesson.teachingSlotId,
    carriedAt: getCurrentIsoDate(),
  });

  await plannerRepository.saveLessons(classroom.id, [sourceLesson, targetLesson]);

  return { sourceLesson, targetLesson };
}
