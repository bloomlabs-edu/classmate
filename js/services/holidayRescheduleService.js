/**
 * services/holidayRescheduleService.js
 *
 * THE FIX for the "adding a holiday silently hides scheduled lessons"
 * gap (see this feature's own investigation report): previously,
 * services/schoolCalendarService.js's own setHolidayException() wrote
 * the exception and nothing else — no Lesson/concept was ever moved,
 * found, or even looked at. ui/views/TimetableView.js's own School
 * Calendar save handler now calls through this service's
 * planHolidayReschedule() BEFORE committing a Holiday exception,
 * whenever any Lesson in the affected range still has real, un-executed
 * content, and applies the result via models/Lesson.js's own
 * rescheduleConceptsForHoliday().
 *
 * PURE AND DEPENDENCY-FREE (no Firestore import) — matching
 * services/schoolCalendarService.js's/services/timetableService.js's
 * own established convention (see either file's own header comment),
 * so this entire planning surface stays directly unit-testable without
 * Node's test runner needing to resolve the real Firestore SDK's own
 * remote `https://` import. The real Firestore reads/writes this
 * feature needs (fetching Lessons/ScheduledEvents in range, persisting
 * the result via plannerRepository.saveLessons()) are deliberately kept
 * OUT of this file and live directly in ui/views/TimetableView.js's own
 * School Calendar save handler instead — the exact same split
 * services/schoolCalendarService.js already has with ITS OWN caller
 * (that file is pure; TimetableView.js does its real Firestore reads
 * around it).
 *
 * IDEMPOTENCY, by construction, not by a separate "already processed"
 * flag: models/Lesson.js's own moveConcept() REMOVES a moved concept
 * from the source Lesson's own conceptIds entirely. A concept already
 * successfully moved by an earlier save is therefore simply no longer
 * present in a Lesson's own open concepts (getOpenConceptIds() below)
 * the next time this plans the same range — re-saving the same Holiday
 * (a retry, or re-opening and re-saving without changing its dates)
 * naturally finds nothing left to move for any Lesson already fully
 * handled, and only ever acts on genuinely new ground (e.g. a Lesson
 * that fell into range because the Holiday's own end date was just
 * extended).
 *
 * EXAM CONFLICTS are deliberately never auto-resolved here — this file
 * only ever reports them (`requiresExamDecision`/`affectedEvents` on
 * the returned plan): it never moves, deletes, or otherwise touches a
 * ScheduledEvent.
 */

import * as timetableService from './timetableService.js';
import * as schoolCalendarService from './schoolCalendarService.js';
import { shiftDateKey } from '../utils/dateHelpers.js';

/** How far past the Holiday's own end date the destination search looks — generous enough for a long break (matches schoolCalendarService.getNextWorkingDate()'s own 120-day default) without scanning forever for a genuinely misconfigured classroom (e.g. a subject with no recurring slot at all). */
export const DEFAULT_SEARCH_HORIZON_DAYS = 120;

/** A concept is still "open work" on a Lesson — eligible to be rescheduled — when it's planned but neither already taught nor already carried forward to a different occurrence. Exported so ui/views/TimetableView.js's own unresolved-items indicator can reuse the identical definition, never a second one. */
export function getOpenConceptIds(lesson) {
  return lesson.conceptIds.filter((conceptId) => !lesson.executedConceptIds.includes(conceptId) && !lesson.carriedForwardConceptIds.includes(conceptId));
}

/**
 * CRITICAL correctness requirement for planHolidayReschedule() below:
 * at planning time the real `classroom` object does NOT yet know about
 * the Holiday being proposed — setHolidayException() is deliberately
 * never called on it until AFTER the teacher confirms (see this file's
 * own header comment: cancelling must leave everything untouched).
 * Without this, services/schoolCalendarService.js's own
 * getWorkingDayStatus() would still see the proposed Holiday's own
 * dates as ordinary working days, and the destination search could
 * suggest landing a rescheduled Lesson right back inside the very range
 * it's being rescheduled OUT of.
 *
 * Returns a CHEAP, shallow-cloned classroom whose `schoolCalendar`
 * already includes the draft exception, safe to pass into
 * getWorkingDayStatus()/getNextFutureSlotForSubject() for planning
 * purposes only — every other field is the exact same reference as the
 * real classroom (read-only use, never mutated here), so this never
 * touches/copies rosters, scores, or anything unrelated to scheduling.
 */
export function buildDraftClassroomWithPendingHoliday(classroom, { startDate, endDate, id }) {
  const draftClassroom = { ...classroom, schoolCalendar: { exceptions: [...(classroom.schoolCalendar?.exceptions || [])] } };
  schoolCalendarService.setHolidayException(draftClassroom, { startDate, endDate }, '', { id });
  return draftClassroom;
}

/**
 * THE core planner. `classroom` MUST be a draft classroom that
 * already has the proposed Holiday applied to its own `schoolCalendar`
 * (see buildDraftClassroomWithPendingHoliday() above) — never the real,
 * not-yet-saved classroom, or the destination search below could select
 * a date still inside the very range being rescheduled out of.
 *
 * For every Lesson in `lessonsAffected` with
 * at least one open concept (getOpenConceptIds()), finds the next
 * holiday-aware, teacher-scoped, occupancy-aware destination slot for
 * its own subject/teacher, reusing timetableService.js's own
 * getNextFutureSlotForSubject() (which already skips Holidays/non-
 * working dates and, when teacherUid is given, any other teacher's own
 * period — see that function's own updated doc comment) rather than
 * re-implementing calendar/teacher awareness here. Occupancy (a
 * candidate slot that already has its own real Lesson) is checked
 * against `lessonsInSearchWindow` — advances to the NEXT candidate on a
 * collision, exactly like timetableService.js's own
 * getOtherFutureSlotsForSubject() already advances a cursor, just with
 * an extra "is this one free" condition layered on top.
 *
 * `subjectIdOf`/`teacherUidOf` resolve a Lesson's own subject/teacher —
 * a Lesson has no subjectId of its own (see models/Lesson.js's own
 * header comment: curriculumUnitId is the only curriculum reference it
 * carries), so these come from resolving the Lesson's own
 * teachingSlotId back to the classroom's CURRENT recurring Timetable
 * pattern for that weekday/period — the same live-resolution principle
 * services/timetableDisplayService.js's own resolveScheduledSlot()
 * already establishes, reused here via timetableService.resolveScheduledSlot()
 * rather than a second implementation.
 */
export function planHolidayReschedule(classroom, { startDate, endDate, lessonsAffected, lessonsInSearchWindow, eventsAffected, horizonDays = DEFAULT_SEARCH_HORIZON_DAYS }) {
  const occupiedTeachingSlotIds = new Set(lessonsInSearchWindow.map((lesson) => lesson.teachingSlotId));

  const entries = lessonsAffected
    .map((lesson) => {
      const openConceptIds = getOpenConceptIds(lesson);
      if (openConceptIds.length === 0) return null; // nothing actionable — fully taught, or already fully carried/rescheduled away

      const periodNumber = timetableService.parsePeriodNumberFromTeachingSlotId(lesson.teachingSlotId);
      const resolved = periodNumber != null ? timetableService.resolveScheduledSlot(classroom, lesson.date, periodNumber) : null;

      if (!resolved) {
        // The recurring Timetable no longer has ANY slot for this
        // Lesson's own weekday/period at all (reconfigured since this
        // Lesson was scheduled — the same "stale schedule" case
        // resolveScheduledSlot() itself already documents) — there is
        // no subject/teacher left to search a destination FOR. Honest,
        // visible "unresolved," never a guess.
        return {
          lesson,
          openConceptIds,
          subjectId: null,
          teacherUid: null,
          destination: null,
          unresolvedReason: 'This period no longer has a subject assigned in the recurring Timetable — nothing to search a replacement period for.',
        };
      }

      const destination = findNextOpenSlot(classroom, {
        subjectId: resolved.subjectId,
        teacherUid: resolved.teacherUid,
        afterDateKey: endDate,
        afterPeriodNumber: 0,
        horizonDays,
        occupiedTeachingSlotIds,
      });
      // Claim it immediately so the NEXT affected Lesson in this same
      // plan (e.g. a date-range holiday displacing two different dated
      // occurrences of the same subject) never independently resolves
      // to this identical slot — occupiedTeachingSlotIds is shared and
      // mutated across this entire .map() pass, sequential by
      // construction (Array.prototype.map never reorders or
      // parallelizes), so each later lookup already sees every earlier
      // entry's own chosen destination as taken.
      if (destination) occupiedTeachingSlotIds.add(destination.id);

      return {
        lesson,
        openConceptIds,
        subjectId: resolved.subjectId,
        teacherUid: resolved.teacherUid,
        destination,
        unresolvedReason: destination
          ? null
          : `No open period for this subject${resolved.teacherUid ? ' and teacher' : ''} found in the next ${horizonDays} days.`,
      };
    })
    .filter(Boolean);

  const affectedEvents = eventsAffected;

  return {
    startDate,
    endDate,
    entries,
    affectedEvents,
    totalOpenConceptCount: entries.reduce((sum, entry) => sum + entry.openConceptIds.length, 0),
    unresolvedCount: entries.filter((entry) => !entry.destination).length,
    requiresExamDecision: affectedEvents.length > 0,
  };
}

/**
 * Advances through candidate slots (timetableService.getNextFutureSlotForSubject(),
 * called repeatedly like getOtherFutureSlotsForSubject() already does)
 * until one is NOT in `occupiedTeachingSlotIds`, or the horizon —
 * measured as an ABSOLUTE date boundary from the ORIGINAL `afterDateKey`,
 * never re-extended — is exhausted.
 *
 * Correctness note: each inner getNextFutureSlotForSubject() call is
 * given its own full `horizonDays` relative to whatever cursor it's
 * handed — necessary so it can always find at least one candidate to
 * reject on occupancy, but NOT a bound on how far this function as a
 * whole may search; without the explicit `horizonBoundaryDateKey` check
 * below, a classroom with many consecutive occupied candidates could
 * have the cursor advance far past the real intended horizon (each
 * rejected candidate "resets the clock" on the inner call), silently
 * searching months beyond what the horizon was supposed to mean.
 */
function findNextOpenSlot(classroom, { subjectId, teacherUid, afterDateKey, afterPeriodNumber, horizonDays, occupiedTeachingSlotIds }) {
  let cursorDateKey = afterDateKey;
  let cursorPeriodNumber = afterPeriodNumber;
  const horizonBoundaryDateKey = shiftDateKey(afterDateKey, horizonDays);

  // Bounded by the number of candidates timetableService.getPeriods()
  // could plausibly produce across the horizon — a generous, finite
  // cap so a pathological classroom (every single slot occupied) can
  // never loop unboundedly; in practice this resolves in one or two
  // iterations for any real classroom.
  const maxAttempts = Math.max(1, timetableService.getPeriods(classroom).length) * (horizonDays + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = timetableService.getNextFutureSlotForSubject(classroom, {
      subjectId,
      teacherUid,
      afterDateKey: cursorDateKey,
      afterPeriodNumber: cursorPeriodNumber,
      horizonDays,
    });
    if (!candidate || candidate.date > horizonBoundaryDateKey) return null;
    if (!occupiedTeachingSlotIds.has(candidate.id)) return candidate;

    cursorDateKey = candidate.date;
    cursorPeriodNumber = candidate.periodNumber;
  }
  return null;
}

/**
 * Live, on-demand "which Holiday-affected Lessons still have open
 * (un-executed, non-carried-forward) concepts sitting on a Holiday
 * date" — deliberately never a separate persisted flag (see this file's
 * own header comment on why idempotency needs none either): a Lesson is
 * "unresolved" for exactly as long as it genuinely still has open
 * concepts on a Holiday date, and stops being unresolved the moment
 * that's no longer true (successfully rescheduled later, manually
 * carried forward, marked executed, or the Holiday itself is
 * edited/removed) — always consistent with live state, never stale.
 * Used by ui/views/TimetableView.js's own Day/Week indicators and its
 * "Lessons needing attention" review panel.
 *
 * `lessons` — every Lesson the caller has already fetched for whatever
 * date range it cares about (e.g. the Timetable's own currently-visible
 * range); this never fetches anything itself. A Lesson is included
 * exactly when its own `date` falls within a real HOLIDAY exception's
 * range AND it still has open concepts.
 */
export function findUnresolvedHolidayLessons(classroom, lessons) {
  const holidayExceptions = schoolCalendarService
    .getCalendarExceptions(classroom)
    .filter((exception) => exception.type === 'holiday');

  return lessons.flatMap((lesson) => {
    const openConceptIds = getOpenConceptIds(lesson);
    if (openConceptIds.length === 0) return [];

    const exception = holidayExceptions.find((candidate) => lesson.date >= candidate.startDate && lesson.date <= candidate.endDate);
    if (!exception) return [];

    return [{ exception, lesson, openConceptIds }];
  });
}
