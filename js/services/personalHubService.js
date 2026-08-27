/**
 * services/personalHubService.js
 *
 * Read-only aggregation for the teacher's Personal Hub landing page
 * (ui/views/PersonalHubView.js). Every function here derives its
 * result from the classrooms already loaded by workspaceService (the
 * classrooms this uid already has access to) plus that data's own
 * existing sub-structures — memberService's real membership, the
 * Timetable pattern (services/timetableService.js), and
 * models/LearningProgramme.js's embedded programmes. Nothing here
 * invents a School or cross-classroom Program entity: neither exists
 * in the data model yet (schoolName is a free-text field per
 * classroom; a Learning Programme is embedded per-classroom, not a
 * shared org-level entity), so "My Schools & Programs" is a grouping
 * view over that existing data, not a new collection. This module
 * intentionally never touches Firestore or mutates a classroom — it
 * only reads.
 */

import * as memberService from './memberService.js';
import { MEMBER_ROLES } from '../config/memberRoles.js';
import * as timetableService from './timetableService.js';
import { resolveSubjectTitle } from './timetableDisplayService.js';
import { getDisplayName } from './classroomService.js';
import { getWeekRange, getPreviousWeekRange, shiftDateKey, getTodayDateKey } from '../utils/dateHelpers.js';

/** Same convention as ui/views/SettingsView.js's own member-list role label. */
export function roleLabel(role) {
  if (role === MEMBER_ROLES.OWNER) return 'Owner';
  if (role === MEMBER_ROLES.VIEWER) return 'Viewer';
  return 'Teacher';
}

/**
 * Splits the uid's classrooms into "manages/teaches" (owner or
 * teacher — the roles that already carry real classroom permissions,
 * see config/memberRoles.js) vs. "member but not primary teacher"
 * (viewer, or any other non-managing role). A classroom this uid has
 * somehow lost membership on (role null — shouldn't happen, since
 * workspaceService only ever loads classrooms this uid has a
 * classroomRefs pointer for) is excluded from both, rather than
 * guessed into either bucket.
 */
export function splitClassroomsByRole(classrooms, uid) {
  const managed = [];
  const other = [];
  for (const classroom of classrooms) {
    const role = memberService.getRole(classroom, uid);
    if (role === MEMBER_ROLES.OWNER || role === MEMBER_ROLES.TEACHER) {
      managed.push(classroom);
    } else if (role) {
      other.push(classroom);
    }
  }
  return { managedClassrooms: managed, otherClassrooms: other };
}

/** Every distinct role this uid holds across their classrooms, in a stable priority order (Owner, then Teacher, then Viewer). */
export function getRolesSummary(classrooms, uid) {
  const roles = new Set(classrooms.map((classroom) => memberService.getRole(classroom, uid)).filter(Boolean));
  return [MEMBER_ROLES.OWNER, MEMBER_ROLES.TEACHER, MEMBER_ROLES.VIEWER].filter((role) => roles.has(role)).map(roleLabel);
}

/**
 * Groups classrooms by their existing free-text schoolName (see
 * models/Classroom.js) — there is no separate School entity to read
 * from. Deliberately built so ManageLearningProgrammeMembersModal-style
 * future PM/HM features can extend one school's own entry (e.g. adding
 * a staff roster) without this shape changing: each entry already
 * carries its own classrooms array, not just a count.
 */
export function getSchools(classrooms) {
  const bySchool = new Map();
  for (const classroom of classrooms) {
    const name = classroom.schoolName || 'Unnamed School';
    if (!bySchool.has(name)) bySchool.set(name, []);
    bySchool.get(name).push(classroom);
  }
  return Array.from(bySchool.entries())
    .map(([schoolName, schoolClassrooms]) => ({ schoolName, classrooms: schoolClassrooms }))
    .sort((a, b) => a.schoolName.localeCompare(b.schoolName));
}

/**
 * Every active Learning Programme (see models/LearningProgramme.js)
 * this uid owns or facilitates, across every classroom they belong
 * to — each tagged with the classroom it lives on, since a programme
 * is only ever embedded on one classroom document, never a
 * standalone collection. Archived programmes are excluded, matching
 * how LearningProgrammesListView already treats 'archived' as hidden
 * by default.
 */
export function getProgrammes(classrooms, uid) {
  const results = [];
  for (const classroom of classrooms) {
    for (const programme of classroom.learningProgrammes || []) {
      if (programme.status !== 'active') continue;
      const isOwner = programme.ownerId === uid;
      const isFacilitator = (programme.facilitatorUids || []).includes(uid);
      if (!isOwner && !isFacilitator) continue;
      results.push({ programme, classroom });
    }
  }
  return results;
}

/**
 * This uid's own classroom + school count, and every concrete
 * TeachingSlot (see services/timetableService.js) across every
 * classroom they belong to for the Monday-start week containing
 * `dateKey` (defaults to the current week). Each slot is tagged with
 * its own classroom and a resolved subject title, so "My Week" can
 * show which classroom/school a period belongs to without a second
 * lookup. Includes every classroom this uid is a member of at all
 * (owner, teacher, or viewer) — a viewer still needs to see their own
 * schedule context, the same way My Week is meant to aggregate
 * "every classroom/program/school they are associated with," not only
 * the ones they manage.
 */
export function getWeekSchedule(classrooms, dateKey = getTodayDateKey()) {
  const range = getWeekRange(dateKey);
  const entries = [];
  for (const classroom of classrooms) {
    const slots = timetableService.getConcreteSlotsForDateRange(classroom, range.start, range.end);
    for (const slot of slots) {
      entries.push({
        ...slot,
        classroomId: classroom.id,
        classroomName: getDisplayName(classroom),
        schoolName: classroom.schoolName,
        subjectTitle: resolveSubjectTitle(classroom, slot.subjectId),
      });
    }
  }
  entries.sort((a, b) => (a.date === b.date ? a.periodNumber - b.periodNumber : a.date < b.date ? -1 : 1));
  return { range, entries };
}

/** The previous Monday-start week's range relative to `dateKey` — mirrors getWeekSchedule()'s own week math via dateHelpers, for the Prev/Next controls. */
export function getPreviousWeekAnchor(dateKey) {
  return getPreviousWeekRange(dateKey).start;
}

/** The next Monday-start week's anchor relative to `dateKey`. */
export function getNextWeekAnchor(dateKey) {
  return shiftDateKey(getWeekRange(dateKey).start, 7);
}

/** Total periods (TeachingSlots) across every classroom this uid belongs to, for the week containing `dateKey`. */
export function countPeriodsThisWeek(classrooms, dateKey = getTodayDateKey()) {
  return getWeekSchedule(classrooms, dateKey).entries.length;
}
