/**
 * services/visitorAccessService.js
 *
 * Builds the one thing a Visitor is ever allowed to read: a deliberately
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
