/**
 * services/timetableLessonService.js
 *
 * Bridges the Timetable (services/timetableService.js) to the Planner
 * domain's Lesson (models/Lesson.js): attaching a lesson plan to one
 * concrete teaching slot, and recording which of its planned concepts
 * were actually executed. Deliberately a separate file from
 * services/plannerService.js: that file owns Planner-engine-generated
 * Lessons (a whole PlanningCycle's worth, computed by a strategy);
 * this one owns the Timetable's own, teacher-driven path — a single
 * Lesson, attached directly to one teachingSlotId, with no
 * PlanningCycle at all (see models/Lesson.js's own `planningCycleId`
 * doc comment). Both produce the exact same Lesson shape and persist
 * through the same services/plannerRepository.js — there is only ever
 * one kind of Lesson, never a parallel entity.
 *
 * Persists the Lesson itself (via plannerRepository), matching
 * services/plannerService.js's own precedent for Lesson writes. Does
 * NOT call services/workspaceService.js's save() — markConceptsExecuted()
 * below also mutates the classroom's own Learning Record tree (via
 * learningRecordTeacherService.setConceptTaughtStatus()), and saving
 * *that* stays the caller's responsibility, the same "mutate here,
 * save() at the call site" convention learningRecordTeacherService.js
 * itself already follows.
 */

import { createLesson, findInvalidExecutedConceptIds, getFeedbackEligibleConceptIds } from '../models/Lesson.js';
import * as plannerRepository from './plannerRepository.js';
import * as learningRecordTeacherService from './learningRecordTeacherService.js';
import * as studentEventService from './studentEventService.js';
import { STUDENT_EVENT_CATEGORIES } from '../config/studentEventCategories.js';
import { getCurrentIsoDate, getTodayDateKey, shiftDateKey } from '../utils/dateHelpers.js';
import { resolveExecutedLessonEntries } from './learningHistoryGrouping.js';

/**
 * Attaches a lesson plan to one concrete Timetable period. `conceptIds`
 * must already be real ids resolved from the classroom's own syllabus
 * tree (see learningRecordTeacherService.js) — this never creates or
 * clones a LearningConcept, only references existing ones by id.
 */
export async function attachLessonPlan(classroom, { teachingSlotId, date, curriculumUnitId, conceptIds = [] }) {
  const lesson = createLesson({
    classroomId: classroom.id,
    date,
    teachingSlotId,
    curriculumUnitId,
    conceptIds,
  });
  await plannerRepository.saveLesson(classroom.id, lesson);
  return lesson;
}

/**
 * Marks exactly which of a Lesson's planned concepts were actually
 * executed in this occurrence. Throws if any id isn't in
 * lesson.conceptIds — executedConceptIds must always be a subset of
 * conceptIds, the one invariant this whole feature depends on; a
 * concept that was carried forward out of this lesson (see
 * services/carryForwardService.js) can never be marked executed here
 * either, since carrying it removes it from conceptIds in the same
 * step (see that file's own comment).
 *
 * Also flips each newly-executed concept's classroom-level
 * LearningConcept.status to 'taught' (learningRecordTeacherService's
 * own setConceptTaughtStatus()) — the same shared flag every other
 * Learning Record surface already reads, kept in sync rather than
 * introducing a second source of truth for "has this concept been
 * taught." The caller still owns workspaceService.save(classroom)
 * afterward — see this file's own header comment for why.
 */
export async function markConceptsExecuted(classroom, lesson, executedConceptIds) {
  const invalid = findInvalidExecutedConceptIds(lesson, executedConceptIds);
  if (invalid.length > 0) {
    throw new Error(`executedConceptIds must be a subset of conceptIds — invalid: ${invalid.join(', ')}`);
  }

  lesson.executedConceptIds = executedConceptIds;
  executedConceptIds.forEach((conceptId) => learningRecordTeacherService.setConceptTaughtStatus(classroom, conceptId, 'taught'));

  await plannerRepository.saveLesson(classroom.id, lesson);
  return lesson;
}

/**
 * "Share feedback with students" — the Period Detail panel's own
 * action. Publishes ONE StudentEvent to every student on the roster
 * (studentEventService.publishEventToAllStudents(), the exact same
 * mechanism assessmentService.publishAssessment() already uses for
 * "your results are ready" — no new notification infrastructure)
 * carrying only a POINTER (`lessonId`) in its payload, never a
 * snapshot of which concepts are involved — see
 * config/studentEventNavigation.js's own header comment for why that
 * convention matters: a student always sees the LIVE, current
 * executedConceptIds when they actually open the flow (see
 * services/studentPortalDataService.js's getConceptFeedbackForLesson()),
 * never a copy that could go stale.
 *
 * Throws if nothing has actually been executed yet — sharing an empty
 * concept list would give students nothing real to respond to. Sets
 * `lesson.feedbackSharedAt`, which the Period Detail panel uses to
 * show "Feedback shared" instead of the button afterward — this
 * function itself does NOT deduplicate a second call for the same
 * Lesson (each call publishes a fresh event to every student again);
 * the UI is what prevents that by only ever showing the action once.
 *
 * `subjectTitle`/`topic` are used only for this event's own display
 * text (title/message) — never persisted anywhere but the event
 * itself, matching every other publisher in this app (see
 * assessmentService.publishAssessment()'s own use of assessment.title).
 */
export async function shareFeedbackWithStudents(classroom, lesson, { subjectTitle, topic }) {
  const eligibleConceptIds = getFeedbackEligibleConceptIds(lesson);
  if (eligibleConceptIds.length === 0) {
    throw new Error('No executed concepts to share feedback on yet.');
  }

  lesson.feedbackSharedAt = getCurrentIsoDate();
  await plannerRepository.saveLesson(classroom.id, lesson);

  studentEventService.publishEventToAllStudents(classroom, {
    type: 'concept_feedback_available',
    category: STUDENT_EVENT_CATEGORIES.LEARNING,
    title: topic ? `${subjectTitle}: ${topic}` : subjectTitle,
    message: 'Your teacher wants to know how well you understood this.',
    payload: { lessonId: lesson.id, teachingSlotId: lesson.teachingSlotId },
  });

  return eligibleConceptIds;
}

export { getFeedbackEligibleConceptIds };

/**
 * Phase 5 (Student Learning View) — every Lesson in the last `days`
 * days that actually had at least one executed concept, resolved into
 * a flat, display-ready shape: one entry per Lesson (date + subject +
 * unit + the concepts really taught that occurrence), newest first is
 * NOT done here — see services/learningHistoryGrouping.js's own
 * sortByDateDesc()/groupByDay() for that, kept pure and separately
 * testable rather than mixed into this Firestore-touching read.
 *
 * A Lesson with `executedConceptIds` referencing a concept id that no
 * longer resolves (deleted from the syllabus tree since) is skipped
 * entirely if NONE of its executed concepts resolve — the honest
 * "nothing real left to show for this occurrence" case, not an error.
 * The actual per-Lesson resolution (subject/unit/concept lookups,
 * skipping a Lesson with nothing real left to show) is
 * services/learningHistoryGrouping.js's own resolveExecutedLessonEntries()
 * — kept there, not here, purely so it's unit-testable without this
 * file's own Firestore dependency; this function is just "fetch, then
 * delegate."
 *
 * Optional `firestoreOverride` — passed straight through to
 * plannerRepository.getLessonsForDateRange(); see that function's own
 * doc comment. services/studentPortalDataService.js's
 * getRecentlyTaughtLessons() is the caller that actually needs this (a
 * student device's default app is never signed in); the Timetable's
 * own teacher-side calls (once it starts using this function, if it
 * ever does) would simply omit it.
 */
export async function getRecentlyTaughtLessons(classroom, { days = 30, todayDateKey = getTodayDateKey(), firestoreOverride = null } = {}) {
  const sinceDateKey = shiftDateKey(todayDateKey, -days);
  const lessons = await plannerRepository.getLessonsForDateRange(classroom.id, sinceDateKey, todayDateKey, firestoreOverride);
  return resolveExecutedLessonEntries(classroom, lessons);
}
