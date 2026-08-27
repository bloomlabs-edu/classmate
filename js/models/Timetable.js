/**
 * models/Timetable.js
 *
 * The recurring WEEKLY PATTERN a classroom's Timetable is built from —
 * deliberately separate from models/TeachingSlot.js, which is one
 * concrete, dated occurrence ("Tue 26 Aug, Period 3, Science").
 * Timetable answers "every Tuesday, Period 3 is Science"; a concrete
 * TeachingSlot for any real date is *derived* from this pattern (see
 * services/timetableService.js's getConcreteSlotsForDateRange()), never
 * stored one-per-date — the pattern itself is small and bounded
 * (a handful of periods x 6 teaching days), so it lives directly on
 * the classroom document, the same "bounded config field" convention
 * already used for `planner`/`notebookConfig` (see models/Classroom.js).
 *
 * The Timetable exists independently of any Lesson/lesson plan — a
 * period already knows its subject (via `slots[].subjectId`) before a
 * teacher ever attaches a lesson plan to it. This is the "preloaded
 * subject tag" the product requires: the subject comes from here, the
 * topic/concepts come later from a Lesson (see models/Lesson.js).
 *
 * `periods` — the shared daily period structure (period number + time
 * range), the same for every weekday (matches the approved reference:
 * Period 1 is always 9:00-9:40, whichever day). `slots` — one entry
 * per (weekday, periodNumber) that actually has a subject taught in
 * it; a (weekday, periodNumber) combination with no matching slot
 * simply has no class that period (rendered as "—" per the reference).
 *
 * `weekday` follows the same 0 (Sun) - 6 (Sat) convention
 * models/TeachingSlot.js already documents, for the same reason: it's
 * carried alongside dates everywhere else in this app
 * (see utils/dateHelpers.js).
 */

import { generateId } from '../utils/idGenerator.js';

/** One row of the shared daily period structure. */
export function createTimetablePeriod({ periodNumber, startTime, endTime } = {}) {
  return {
    periodNumber, // 1-based
    startTime, // "HH:mm", 24-hour, e.g. "09:00"
    endTime, // "HH:mm"
  };
}

/**
 * One recurring weekly assignment: this weekday's this period is this
 * subject.
 *
 * `teacherUid` — nullable, the real Firebase Auth uid of whichever
 * classroom member (see models/Classroom.js's own `members` map)
 * actually teaches this specific period, distinct from `subjectId`
 * itself. Added so "what does THIS teacher teach in this classroom"
 * (see services/personalHubService.js's getSubjectsTaughtInClassroom())
 * can be answered from real, explicitly-set data rather than guessed —
 * a classroom's `timetable` is one shared weekly pattern read by every
 * member (owner, every co-teacher, every viewer), and before this
 * field existed nothing distinguished which specific member actually
 * teaches which period. `null` (the default, and the value on every
 * slot that predates this field) means "not yet assigned" — a real,
 * legitimate state, never backfilled with a guess; see
 * ui/views/TimetableView.js's own Manage Timetable "Taught by" picker
 * for the one place this is ever set, alongside the existing subject
 * picker for that same period.
 */
export function createTimetableSlot({ weekday, periodNumber, subjectId, teacherUid = null } = {}) {
  return {
    weekday, // 0 (Sun) - 6 (Sat)
    periodNumber,
    subjectId, // canonical subjectId — see services/subjectIdentityService.js
    teacherUid,
  };
}

export function createTimetable({ id, classroomId, periods = [], slots = [] } = {}) {
  return {
    id: id || generateId(),
    classroomId,
    periods,
    slots,
  };
}
