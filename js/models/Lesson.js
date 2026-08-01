/**
 * models/Lesson.js
 *
 * The scheduled teaching entity — one occurrence of teaching one piece
 * of curriculum content, assigned to one Teaching Slot (see
 * models/TeachingSlot.js). References curriculum content by id only,
 * never copies it: `curriculumUnitId` and `conceptIds` are resolved
 * live against the Curriculum domain at display time, the same
 * reference-not-copy principle already established for
 * AssessmentSubject.subjectId and Learning Management's Subject ->
 * Curriculum Index link. Curriculum stays the single source of truth;
 * a unit renamed or a concept reworded later needs no Lesson
 * migration.
 *
 * `conceptIds` is an array, not a single `conceptId` — this is a
 * deliberate difference from the earlier draft of this model. Two
 * reasons: it gives the "Concept Builder isn't built yet" fallback
 * (see services/plannerStrategies/balancedStrategy.js) a natural
 * empty-array representation (`conceptIds: []` for a whole-unit
 * placeholder lesson) rather than a special-cased null, and it leaves
 * room for a future strategy to schedule more than one concept per
 * lesson without another model change.
 *
 * `teachingSlotId` references models/TeachingSlot.js's own generated
 * id — not the slot's date/period directly, so a Lesson's origin slot
 * stays traceable even if slot data is later regenerated or replaced
 * by a different source (manual entry today, a real Timetable
 * eventually).
 *
 * `estimatedMinutes` is populated from the originating Teaching Slot's
 * own `duration` at generation time — what the lesson was scheduled
 * to take. `actualMinutes` stays null until a teacher records it after
 * the fact; nothing in this milestone sets it.
 *
 * `status` — 'planned' | 'taught' | 'skipped' | 'rescheduled'. Nothing
 * in this milestone changes it after creation (no calendar UI, no
 * teacher-facing status controls yet) — see
 * services/plannerService.js's recordLessonStatusChange() for the one
 * piece of status-transition logic this milestone does include, ready
 * for a future UI to call.
 */

import { generateId } from '../utils/idGenerator.js';

export function createLesson({
  id,
  planningCycleId,
  classroomId,
  date,
  teachingSlotId,
  curriculumUnitId,
  conceptIds = [],
  sequenceIndex,
  estimatedMinutes = null,
  actualMinutes = null,
  status = 'planned',
} = {}) {
  return {
    id: id || generateId(),
    planningCycleId,
    classroomId,
    date,
    teachingSlotId,
    curriculumUnitId,
    conceptIds,
    sequenceIndex,
    estimatedMinutes,
    actualMinutes,
    status,
  };
}
