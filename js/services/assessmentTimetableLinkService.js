/**
 * services/assessmentTimetableLinkService.js
 *
 * The one bridge between Timetable/Scheduled Events and Assessment
 * Management — deliberately its own small module rather than folded
 * into either assessmentService.js or scheduledEventService.js, since
 * it's the only place that needs to know about both domains at once
 * (see this feature's own architecture note: Assessment Management is
 * otherwise independent of Learning Management/Timetable by design).
 *
 * Pure logic over already-fetched data — no Firestore import here,
 * matching the same "stays directly unit-testable" convention
 * services/scheduledEventService.js and services/timetableDisplayService.js
 * already establish. Callers fetch ScheduledEvents via
 * services/scheduledEventRepository.js themselves (see
 * ui/views/AssessmentManagementView.js) and hand the results in.
 *
 * Core rule this file enforces: a Timetable exam SUGGESTS an
 * Assessment; it never GRANTS one. A ScheduledEvent's subject must
 * already be a real Subject in this classroom's own Learning Record
 * (i.e. the teacher has it in their Learning Activities) before it is
 * even surfaced as a candidate here — an exam for a subject the
 * classroom hasn't added to Learning Record yet (e.g. Physical
 * Education, when only Science/Social Science/Mathematics have been
 * added) never appears in this module's output at all, and nothing
 * here ever creates an Assessment on its own; that only happens when
 * a caller explicitly invokes
 * services/assessmentService.js's createAssessmentFromScheduledEvent()
 * in response to a teacher's own "Set up Assessment" click.
 */

import { findLearningSubjectByCanonicalId } from './timetableDisplayService.js';
import { getEffectiveScheduleForDate } from './schoolCalendarService.js';

/**
 * Every exam-type ScheduledEvent eligible to surface on the
 * Assessments page, paired with the classroom's own matching
 * LearningSubject (never null in the result — see filter below) and
 * whatever Assessment, if any, is already linked to it.
 *
 * `examEvents` must already be filtered to `eventType: 'exam'` (see
 * services/scheduledEventService.js's own getEventsByType()) — this
 * function doesn't re-check eventType itself, so a future second event
 * type never needs a change here, only at the call site's own filter.
 *
 * An event whose `subjectId` has no matching LearningSubject in this
 * classroom (not in Learning Activities — the Physical Education
 * example) is silently excluded from the returned list entirely. This
 * is the ONE gate this whole feature exists to enforce: Timetable
 * visibility of an exam is never treated as assessment access.
 */
export function getSurfaceableExamAssessments(classroom, examEvents, assessments) {
  return examEvents
    .map((event) => ({
      event,
      learningSubject: event.subjectId ? findLearningSubjectByCanonicalId(classroom, event.subjectId) : null,
    }))
    .filter(({ learningSubject }) => learningSubject !== null)
    .map(({ event, learningSubject }) => ({
      event,
      learningSubject,
      subjectTitle: learningSubject.title,
      linkedAssessment: assessments.find((assessment) => assessment.scheduledEventId === event.id) || null,
    }));
}

/**
 * "Period 1" / "Period 1–2" for one ScheduledEvent, resolved via
 * services/schoolCalendarService.js's own getEffectiveScheduleForDate()
 * — never a second, independent period calculation. `null` when the
 * event's own time range doesn't actually overlap any recurring period
 * on its date (e.g. an exam scheduled entirely outside school hours),
 * so callers can honestly omit the period rather than show a
 * fabricated one.
 *
 * Always recomputed from the live event + live timetable/calendar
 * state, every call — this is what makes a linked Assessment's display
 * automatically follow a Timetable reschedule rather than freezing the
 * period at Assessment-creation time.
 */
export function getEventPeriodLabel(classroom, event) {
  const schedule = getEffectiveScheduleForDate(classroom, event.date, [event]);
  const overlappingPeriodNumbers = schedule.periods.filter((period) => period.suppressedByEventId === event.id).map((period) => period.periodNumber);

  if (overlappingPeriodNumbers.length === 0) return null;

  const min = Math.min(...overlappingPeriodNumbers);
  const max = Math.max(...overlappingPeriodNumbers);
  return min === max ? `Period ${min}` : `Period ${min}–${max}`;
}
