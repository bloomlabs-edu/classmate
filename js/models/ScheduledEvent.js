/**
 * models/ScheduledEvent.js
 *
 * A date-specific occurrence on the Timetable that is NOT a Lesson —
 * the "Scheduled Event" half of "Timetable -> Lesson | Scheduled Event"
 * (see this feature's own architecture brief). An exam is the first
 * real `eventType`; the shape is deliberately generic (`eventType` +
 * a small set of fields every kind of event plausibly needs) so a
 * future Assembly/School Event/Field Trip needs no model change, only
 * a new SCHEDULED_EVENT_TYPES entry and whatever type-specific display
 * ui/views/TimetableView.js chooses to add for it — nothing here
 * assumes "exam" is the only kind that will ever exist.
 *
 * Deliberately its OWN entity, never a Lesson with some fields blank:
 * a Lesson exists to carry curriculumUnitId/conceptIds/executedConceptIds/
 * feedbackSharedAt — real teaching-and-learning state that has no
 * meaning for an exam. Forcing an exam through that shape would mean
 * either fabricating fake concept data or leaving a permanently-empty
 * Lesson sitting in the Planner's own domain, both worse than a second,
 * narrower model. See docs/CLASSMATE_WEEKLY_PLAN_AND_LESSON_PLAN_ARCHITECTURE.md
 * for this app's own precedent of splitting genuinely different
 * planning artifacts into separate models rather than overloading one.
 *
 * Storage: own Firestore subcollection,
 * `classrooms/{classroomId}/scheduledEvents/{eventId}` (see
 * services/scheduledEventRepository.js) — the same "own subcollection,
 * never embedded in the classroom document" convention already
 * established for Lessons/Resources/Activities, for the identical
 * reason: a multi-year history of exams/events is real, unbounded
 * growth.
 *
 * `date`/`startTime`/`endTime` are this event's own, independent time
 * range — deliberately NOT tied to any Timetable `periodNumber`. An
 * exam routinely spans what would normally be two separate periods
 * (see this feature's own worked example: "09:00–10:30 Science Exam"
 * covering ground two 45-minute periods would each occupy) — pinning
 * it to a period number would either truncate it or force an artificial
 * multi-period model this app doesn't otherwise have. Which recurring
 * periods (if any) this event overlaps on its own date is computed on
 * demand by services/schoolCalendarService.js's own
 * getEffectiveScheduleForDate(), never stored here.
 *
 * `subjectId` is the same canonical subjectId every other Timetable
 * reference already uses (services/subjectIdentityService.js) —
 * optional, since not every future event type will have one (an
 * Assembly has no subject), but an Exam always should.
 *
 * `customSubjectName` is the free-typed display text for a subject not
 * on config/canonicalSubjectsConfig.js's own list — optional, and only
 * ever set together with `subjectId`, never instead of it: whichever
 * UI creates the event (ui/views/TimetableView.js) is responsible for
 * first deriving `subjectId` from this same typed text via
 * services/subjectIdentityService.js's own generateCustomSubjectId()
 * (the identical deterministic-slugify convention every other free-
 * typed subject already uses), and setting both fields on the event
 * together. Nothing here does that derivation itself — this model only
 * carries the two already-decided values. When present,
 * `resolveEventSubjectTitle()` (services/scheduledEventService.js)
 * returns this text directly as the display title, ahead of any
 * canonical/Learning-Record lookup, since a free-typed title is never
 * something a lookup could reconstruct from `subjectId` alone.
 *

 * Deliberately does NOT carry curriculumUnitId, conceptIds,
 * executedConceptIds, lessonPlanId, or any other Lesson-specific field
 * — per explicit product direction, nothing here should ever tempt a
 * caller to treat an exam as a Lesson with extra fields.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/** Today's one real event type. Deliberately a small, extensible registry — see this file's own header comment for the future types this shape already accommodates without a rewrite. */
export const SCHEDULED_EVENT_TYPES = Object.freeze({
  EXAM: 'exam',
});

export function createScheduledEvent({
  id,
  classroomId,
  date, // "YYYY-MM-DD"
  startTime, // "HH:mm"
  endTime, // "HH:mm"
  eventType = SCHEDULED_EVENT_TYPES.EXAM,
  title = '', // e.g. "Term 1 Science Examination"
  subjectId = null, // canonical subjectId, optional (not every future event type has one)
  customSubjectName = null, // free-typed display text for a subject not on the canonical list, optional — see this file's own header comment
  gradeLabel = '',
  room = '',
  invigilatorUid = null, // a classroom member's uid — same "reference, not a copy" convention models/Timetable.js's own teacherUid already uses
  createdAt,
  updatedAt,
} = {}) {
  const timestamp = createdAt || getCurrentIsoDate();
  return {
    id: id || generateId(),
    classroomId,
    date,
    startTime,
    endTime,
    eventType,
    title,
    subjectId,
    customSubjectName,
    gradeLabel,
    room,
    invigilatorUid,
    createdAt: timestamp,
    updatedAt: updatedAt || timestamp,
  };
}
