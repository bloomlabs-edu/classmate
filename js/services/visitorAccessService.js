/**
 * services/visitorAccessService.js
 *
 * Presented to teachers and invitees alike as a "Classroom Tour" (see
 * ui/views/VisitorAccessView.js) — never as a permissions/access
 * feature. Builds the one thing a Visitor is ever allowed to read: a deliberately
 * SANITIZED, point-in-time snapshot of a classroom's own curriculum/
 * timetable STRUCTURE — never the classroom's real Firestore document.
 *
 * Why a snapshot, not "read-only access to the real classroom": every
 * other classroom-scoped Firestore collection in this app (and the
 * classroom document itself) is gated purely on membership
 * (`uid in memberUids`), with no role-based distinction between
 * teacher/viewer today (see firestore.rules' own header comment on
 * this exact gap). A Visitor is explicitly NOT a member of anything
 * (see services/classroomService.js's own ensureVisitorAccessCode()
 * doc comment) — so there is no existing enforcement point that could
 * make "read-only access to the live classroom" actually safe without
 * a much larger rules-hardening pass across every collection (lessons,
 * resources, activities, scoreboardArchives, notifications, feed
 * posts, studentGoals, studentConceptRecords, lesson plans...). A
 * teacher showing another teacher "how a ClassMate classroom works" per
 * explicit product direction doesn't need any of that — it needs a
 * faithful DEMONSTRATION of structure, not the real roster.
 *
 * `buildVisitorSnapshot()` is therefore an explicit ALLOW-list, not a
 * "copy everything except an exclude-list" — the safest shape for
 * something a stranger with a link can read with no sign-in at all.
 * Deliberately excludes (never even touched): teams/students (real
 * names, scores, notebooks, goals), members, every join/reset code,
 * lesson plans, resources, activities, assessments, notifications,
 * feed posts. Only classroom identity + curriculum/timetable
 * STRUCTURE (subject/unit/concept titles, period times, which subject
 * is taught which period) — the same kind of information already
 * visible to anyone glancing at a classroom's own printed timetable on
 * a wall, nothing a teacher would consider private.
 */

import { getDisplayName } from './classroomService.js';
import { resolveSubjectTitle } from './timetableDisplayService.js';

/**
 * A fixed, hand-written illustration of the real "5 Questions"
 * lesson-planning framework (see models/LessonPlan.js's own header
 * comment) — used ONLY by the Classroom Tour's own Lesson Planning
 * section (ui/views/VisitorAccessView.js), NEVER derived from this
 * classroom's actual lesson plans.
 *
 * Real lesson plans are full of teacher-authored free text (Spark,
 * Activities, differentiation buckets, Teacher Look-Fors...) that
 * could plausibly reference real students by name or circumstance —
 * there is no existing per-field review step that could certify a
 * given plan safe to show a stranger with no sign-in, and
 * buildVisitorSnapshot() below deliberately never touches
 * classroom.learningActivities/lessonPlans at all (see this file's own
 * header comment on why the snapshot stays an explicit allow-list).
 * Rather than weaken that model, this is a clearly-labeled, generic
 * example — illustrating the real framework honestly, fabricating
 * nothing that looks like a real student or a real lesson.
 */
export const SAMPLE_LESSON_PLAN_QUESTIONS = Object.freeze([
  Object.freeze({
    number: '1',
    question: 'Why are students learning what they are learning today?',
    description: 'Every lesson starts with a real objective and a Big Question — never just "cover the chapter."',
  }),
  Object.freeze({
    number: '2',
    question: 'Will it advance Self, Others & India?',
    description: 'Teachers connect the lesson to who a student is becoming, not just what they can recall.',
  }),
  Object.freeze({
    number: '3',
    question: 'Are students showcasing learning and applying the content?',
    description: 'Real evidence of understanding — an exit ticket, a demonstration — not just a worksheet.',
  }),
  Object.freeze({
    number: '4',
    question: 'Is it fun, fast, effective?',
    description: 'A Spark to open the lesson, then hands-on activities that keep the whole class moving.',
  }),
  Object.freeze({
    number: '5',
    question: 'Are students helping me and others learn?',
    description: 'Students explain their own thinking to a partner, so understanding multiplies around the room.',
  }),
]);

/**
 * `{ classroomName, gradeSection, schoolName, subjects, timetable, generatedAt }`
 * — see this file's own header comment for exactly what is and is not
 * included. Pure and side-effect-free: the caller (see
 * ui/views/StudentAccessView.js's Visitor tile) is responsible for
 * actually persisting the result via workspaceService.createVisitorAccess().
 */
export function buildVisitorSnapshot(classroom) {
  const subjects = (classroom.learningRecord?.subjects || []).map((subject) => ({
    title: subject.title,
    units: (subject.units || []).map((unit) => ({
      title: unit.title,
      concepts: (unit.concepts || []).map((concept) => ({ title: concept.title })),
    })),
  }));

  const periods = classroom.timetable?.periods || [];
  const slots = (classroom.timetable?.slots || []).map((slot) => ({
    weekday: slot.weekday,
    periodNumber: slot.periodNumber,
    subjectTitle: resolveSubjectTitle(classroom, slot.subjectId),
  }));

  return {
    classroomName: getDisplayName(classroom),
    gradeSection: classroom.gradeSection || '',
    schoolName: classroom.schoolName || '',
    subjects,
    timetable: { periods, slots },
    generatedAt: new Date().toISOString(),
  };
}
