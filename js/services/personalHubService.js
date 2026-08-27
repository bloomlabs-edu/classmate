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
import { DEFAULT_GROUP_COLORS } from '../config/groupColorConfig.js';
import { getWeekRange, getPreviousWeekRange, shiftDateKey, getTodayDateKey } from '../utils/dateHelpers.js';

/**
 * The distinct subjects `uid` actually teaches in `classroom`, derived
 * from real, explicitly-set data — every recurring TimetableSlot
 * (see services/timetableService.js's getSlotsForTeacher()) whose own
 * `teacherUid` is this uid, resolved to display titles via
 * timetableDisplayService and deduplicated (a teacher covering the
 * same subject across several periods/days should see it once, not
 * once per period). Alphabetically sorted for a stable, predictable
 * order rather than "whichever period happened to come first."
 *
 * Returns an empty array — never a guess — for a classroom where this
 * uid hasn't been assigned to any period yet (teacherUid still null
 * on every slot, e.g. a classroom created before this field existed,
 * or one where "Taught by" hasn't been set in Manage Timetable yet).
 * See ui/views/PersonalHubView.js for how an empty result is
 * presented (the "YOU TEACH" line is omitted entirely, never shown as
 * a false "you teach nothing").
 */
export function getSubjectsTaughtInClassroom(classroom, uid) {
  const subjectIds = new Set(timetableService.getSlotsForTeacher(classroom, uid).map((slot) => slot.subjectId));
  return Array.from(subjectIds)
    .map((subjectId) => resolveSubjectTitle(classroom, subjectId))
    .sort((a, b) => a.localeCompare(b));
}

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
 * from. `teacherCount` is the union of memberUids across every
 * classroom at that school (a co-teacher on two classrooms at the
 * same school is counted once) — the same member list every
 * classroom card already surfaces via classroomService.getMemberCount,
 * just merged across a school's own classrooms rather than one at a
 * time. Deliberately built so a future PM/HM phase can extend one
 * school's own entry (e.g. adding a staff roster) without this shape
 * changing: each entry already carries its own classrooms array, not
 * just a count.
 *
 * KNOWN LIMITATION — flagged explicitly for the future PM/HM phase,
 * per product direction: this is a DERIVED grouping by a free-text
 * string a teacher typed into "School Name" when creating a
 * classroom, not a verified school affiliation or employment record.
 * Two classrooms with slightly different spellings/casing of the same
 * real school ("CHS Kannamapet" vs "C.H.S. Kannamapet") would
 * currently show up as two separate entries here, and there is no
 * check that this uid is actually, formally associated with a school
 * beyond "a classroom they can see happens to have this string in its
 * schoolName field." Callers (see ui/views/PersonalHubView.js) must
 * present this as an informal grouping, never as confirmed
 * affiliation/headcount data — a real School entity with verified
 * membership is a PM/HM-phase data-model decision, not something this
 * read-only aggregation should paper over by pretending schoolName
 * strings are already that.
 */
export function getSchools(classrooms) {
  const bySchool = new Map();
  for (const classroom of classrooms) {
    const name = classroom.schoolName || 'Unnamed School';
    if (!bySchool.has(name)) bySchool.set(name, []);
    bySchool.get(name).push(classroom);
  }
  return Array.from(bySchool.entries())
    .map(([schoolName, schoolClassrooms]) => {
      const teacherUids = new Set();
      schoolClassrooms.forEach((classroom) => (classroom.memberUids || []).forEach((uid) => teacherUids.add(uid)));
      return { schoolName, classrooms: schoolClassrooms, teacherCount: teacherUids.size };
    })
    .sort((a, b) => a.schoolName.localeCompare(b.schoolName));
}

/**
 * Every active Learning Programme (see models/LearningProgramme.js)
 * this uid owns or facilitates, across every classroom they belong
 * to — each tagged with the classroom it lives on (a programme is
 * only ever embedded on one classroom document, never a standalone
 * collection) and this uid's own real relationship to it ('Owner' if
 * `ownerId` matches, 'Facilitator' if only `facilitatorUids` does —
 * never both labels at once, `ownerId` takes precedence since an
 * owner is also implicitly free to facilitate). Archived programmes
 * are excluded, matching how LearningProgrammesListView already
 * treats 'archived' as hidden by default.
 */
export function getProgrammes(classrooms, uid) {
  const results = [];
  for (const classroom of classrooms) {
    for (const programme of classroom.learningProgrammes || []) {
      if (programme.status !== 'active') continue;
      const isOwner = programme.ownerId === uid;
      const isFacilitator = (programme.facilitatorUids || []).includes(uid);
      if (!isOwner && !isFacilitator) continue;
      results.push({ programme, classroom, roleLabel: isOwner ? 'Owner' : 'Facilitator' });
    }
  }
  return results;
}

/** "09:00" -> "09:00 AM", "13:00" -> "01:00 PM" — the display format the approved reference uses for a period's start time. Malformed input returns it unchanged rather than throwing. */
export function formatPeriodTime(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hhmm)) return hhmm;
  const [hour, minute] = hhmm.split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(displayHour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${period}`;
}

/**
 * A stable color per classroom, keyed by classroom id — the same
 * "cycle through a fixed palette by index" convention
 * config/groupColorConfig.js already uses for auto-assigning a Team's
 * color, just applied to classrooms instead: consistent order (the
 * order `classrooms` is given in) means the same classroom always
 * gets the same color across the Today strip, My Week grid, and their
 * shared legend within one render.
 */
export function buildClassroomColorMap(classrooms) {
  const map = new Map();
  classrooms.forEach((classroom, index) => {
    const color = DEFAULT_GROUP_COLORS[index % DEFAULT_GROUP_COLORS.length];
    map.set(classroom.id, color);
  });
  return map;
}

/**
 * Whether ANY slot in this classroom's own recurring timetable has
 * ever been given a real "Taught by" assignment (see
 * models/Timetable.js's own `teacherUid` doc comment) — i.e. whether
 * per-teacher assignment has been set up for this classroom AT ALL,
 * not whether this specific uid has one.
 *
 * This is the fallback rule Today/My Week both use (see
 * buildScheduleEntries() below), decided explicitly rather than
 * picking one silently: `teacherUid: null` is not one single meaning
 * — it means two different real things depending on context, and
 * conflating them would either hide a classroom's whole schedule from
 * everyone the first day this feature ships, or defeat the point of
 * having per-teacher filtering at all once a classroom has adopted it.
 *   - A classroom that has NEVER used "Taught by" (every slot's
 *     teacherUid is still null) — filtering Today/My Week down to
 *     `slot.teacherUid === uid` would show NOTHING for anyone, which
 *     is a straight regression versus what Today already showed
 *     before this field existed. For a classroom in this state, this
 *     function returns false, and the caller keeps showing every
 *     period in the classroom to everyone, exactly like before.
 *   - A classroom where AT LEAST ONE slot has a real teacherUid — the
 *     classroom has opted into per-teacher assignment, so an
 *     unassigned slot within it (still null) is a real, distinct fact
 *     ("nobody's confirmed who teaches this one yet"), not "everyone
 *     teaches it." This function returns true, and the caller filters
 *     strictly to this uid's own assigned periods for that classroom.
 */
function classroomHasAnyTeacherAssignment(classroom) {
  return timetableService.getTimetable(classroom).slots.some((slot) => slot.teacherUid != null);
}

function buildScheduleEntries(classrooms, startDateKey, endDateKey, uid) {
  const entries = [];
  for (const classroom of classrooms) {
    const periodsByNumber = new Map(timetableService.getPeriods(classroom).map((period) => [period.periodNumber, period]));
    const slots = timetableService.getConcreteSlotsForDateRange(classroom, startDateKey, endDateKey);
    const filterToThisTeacher = classroomHasAnyTeacherAssignment(classroom);
    for (const slot of slots) {
      if (filterToThisTeacher && slot.teacherUid !== uid) continue;
      entries.push({
        ...slot,
        classroomId: classroom.id,
        classroomName: getDisplayName(classroom),
        schoolName: classroom.schoolName,
        subjectTitle: resolveSubjectTitle(classroom, slot.subjectId),
        startTime: periodsByNumber.get(slot.periodNumber)?.startTime || null,
      });
    }
  }
  entries.sort((a, b) => (a.date === b.date ? a.periodNumber - b.periodNumber : a.date < b.date ? -1 : 1));
  return entries;
}

/**
 * Every concrete TeachingSlot across every classroom this uid belongs
 * to, for just `dateKey` (defaults to today) — what the "Today" strip
 * shows. Includes every classroom this uid is a member of at all
 * (owner, teacher, or viewer), not only the ones they manage, since
 * their own day's schedule spans all of them. Per classroom, filtered
 * to this uid's own assigned periods once that classroom has adopted
 * "Taught by" at all — see classroomHasAnyTeacherAssignment() above
 * for the exact fallback rule and why.
 */
export function getTodaySchedule(classrooms, uid, dateKey = getTodayDateKey()) {
  return buildScheduleEntries(classrooms, dateKey, dateKey, uid);
}

/**
 * This uid's own aggregated timetable for the Monday-start week
 * containing `dateKey` (defaults to the current week): every concrete
 * TeachingSlot (see services/timetableService.js) across every
 * classroom they belong to, tagged with its own classroom/subject
 * context and real start time. Same per-classroom "Taught by" filter
 * as getTodaySchedule() above.
 */
export function getWeekSchedule(classrooms, uid, dateKey = getTodayDateKey()) {
  const range = getWeekRange(dateKey);
  return { range, entries: buildScheduleEntries(classrooms, range.start, range.end, uid) };
}

/**
 * The My Week grid's own row structure — one row per distinct real
 * period start time across EVERY classroom this uid belongs to (not
 * per period *number*, since two classrooms can number their periods
 * differently but still both genuinely start at 9:00), each holding
 * that time's entries bucketed by date. Mirrors the approved
 * reference's own time-labeled rows (9:00 AM, 11:00 AM, ...) exactly,
 * rather than a generic "Period 1/2/3" axis that would only be
 * accurate for a single classroom's own numbering.
 */
export function getWeekGrid(classrooms, uid, dateKey = getTodayDateKey()) {
  const { range, entries } = getWeekSchedule(classrooms, uid, dateKey);

  const days = [];
  for (let d = range.start; d <= range.end; d = shiftDateKey(d, 1)) days.push(d);

  const rowsByTime = new Map();
  for (const entry of entries) {
    const timeKey = entry.startTime || '';
    if (!rowsByTime.has(timeKey)) rowsByTime.set(timeKey, new Map());
    const byDate = rowsByTime.get(timeKey);
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }

  const rows = Array.from(rowsByTime.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([startTime, byDate]) => ({ startTime, cellsByDate: byDate }));

  return { range, days, rows };
}

/** The previous Monday-start week's range relative to `dateKey` — mirrors getWeekSchedule()'s own week math via dateHelpers, for the Prev/Next controls. */
export function getPreviousWeekAnchor(dateKey) {
  return getPreviousWeekRange(dateKey).start;
}

/** The next Monday-start week's anchor relative to `dateKey`. */
export function getNextWeekAnchor(dateKey) {
  return shiftDateKey(getWeekRange(dateKey).start, 7);
}

/** Total periods (TeachingSlots) across every classroom this uid belongs to, for the week containing `dateKey`. Same per-classroom "Taught by" filter as getWeekSchedule() — this count matches exactly what My Week's own grid shows. */
export function countPeriodsThisWeek(classrooms, uid, dateKey = getTodayDateKey()) {
  return getWeekSchedule(classrooms, uid, dateKey).entries.length;
}
