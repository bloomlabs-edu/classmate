/**
 * services/timetableService.js
 *
 * Owns the Timetable domain: the recurring weekly pattern (see
 * models/Timetable.js) and deriving concrete, dated
 * models/TeachingSlot.js instances from it on demand. No Firestore
 * calls here — `timetable` lives directly on the classroom object
 * (see models/Classroom.js) and is persisted the ordinary way, via
 * services/workspaceService.js's save(), the same "mutate then caller
 * saves" convention services/learningRecordTeacherService.js already
 * uses. Firestore-backed data (Lesson) is a separate concern, owned by
 * services/plannerService.js / services/plannerRepository.js.
 *
 * Never invents dummy timetable data — every function here reads from
 * (or writes to) the real classroom.timetable object the caller
 * provides. An empty timetable is a real, valid state (nothing
 * configured yet), always represented as `{ periods: [], slots: [] }`,
 * never fabricated placeholder periods/slots.
 */

import { createTimetable, createTimetableSlot } from '../models/Timetable.js';
import { createTeachingSlot } from '../models/TeachingSlot.js';
import { toDateKey, shiftDateKey } from '../utils/dateHelpers.js';

function ensureTimetable(classroom) {
  if (!classroom.timetable) classroom.timetable = createTimetable({ classroomId: classroom.id });
  if (!Array.isArray(classroom.timetable.periods)) classroom.timetable.periods = [];
  if (!Array.isArray(classroom.timetable.slots)) classroom.timetable.slots = [];
  return classroom.timetable;
}

export function getTimetable(classroom) {
  return ensureTimetable(classroom);
}

/** The shared daily period structure, ordered by periodNumber. */
export function getPeriods(classroom) {
  return [...ensureTimetable(classroom).periods].sort((a, b) => a.periodNumber - b.periodNumber);
}

/** Replaces the whole period structure — caller still owns saving the classroom afterward. */
export function setPeriods(classroom, periods) {
  ensureTimetable(classroom).periods = periods;
  return classroom.timetable;
}

/** The recurring slot for one (weekday, periodNumber), or null if that period has no class. */
export function getSlot(classroom, weekday, periodNumber) {
  const timetable = ensureTimetable(classroom);
  return timetable.slots.find((slot) => slot.weekday === weekday && slot.periodNumber === periodNumber) || null;
}

/** Every recurring slot for one weekday, ordered by periodNumber. */
export function getSlotsForWeekday(classroom, weekday) {
  return ensureTimetable(classroom)
    .slots.filter((slot) => slot.weekday === weekday)
    .sort((a, b) => a.periodNumber - b.periodNumber);
}

/** Sets (or replaces) the subject taught in one (weekday, periodNumber) slot. */
export function upsertSlot(classroom, { weekday, periodNumber, subjectId }) {
  const timetable = ensureTimetable(classroom);
  const existing = timetable.slots.find((slot) => slot.weekday === weekday && slot.periodNumber === periodNumber);
  if (existing) {
    existing.subjectId = subjectId;
  } else {
    timetable.slots.push(createTimetableSlot({ weekday, periodNumber, subjectId }));
  }
  return timetable;
}

/** Clears the subject from one (weekday, periodNumber) — that period becomes "no class" ("—" in the UI). */
export function removeSlot(classroom, { weekday, periodNumber }) {
  const timetable = ensureTimetable(classroom);
  timetable.slots = timetable.slots.filter((slot) => !(slot.weekday === weekday && slot.periodNumber === periodNumber));
  return timetable;
}

/** A stable, deterministic id for the concrete TeachingSlot at one real date+period — so a Lesson's own teachingSlotId stays consistent every time this same (classroom, date, period) is recomputed, with no separate persistence needed for the concrete occurrence itself. */
export function buildTeachingSlotId(classroomId, dateKey, periodNumber) {
  return `${classroomId}_${dateKey}_p${periodNumber}`;
}

function weekdayOfDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

/**
 * Every concrete TeachingSlot in [startDateKey, endDateKey] (inclusive),
 * derived from the recurring pattern — one per (date, configured
 * period), skipping any (weekday, periodNumber) with no matching slot.
 * Ordered by date, then periodNumber. This is what the Timetable Week/
 * Day grid renders; it is never persisted on its own — a slot only
 * becomes durable once a Lesson (see models/Lesson.js) is attached to
 * its id (see buildTeachingSlotId() above).
 */
export function getConcreteSlotsForDateRange(classroom, startDateKey, endDateKey) {
  const periods = getPeriods(classroom);
  const slots = [];

  for (let dateKey = startDateKey; dateKey <= endDateKey; dateKey = shiftDateKey(dateKey, 1)) {
    const weekday = weekdayOfDateKey(dateKey);
    for (const period of periods) {
      const slot = getSlot(classroom, weekday, period.periodNumber);
      if (!slot) continue;
      slots.push(
        createTeachingSlot({
          id: buildTeachingSlotId(classroom.id, dateKey, period.periodNumber),
          date: dateKey,
          weekday,
          periodNumber: period.periodNumber,
          duration: minutesBetween(period.startTime, period.endTime),
          subjectId: slot.subjectId,
        })
      );
    }
  }

  return slots;
}

function minutesBetween(startTime, endTime) {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  return (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
}

/**
 * The next concrete TeachingSlot, strictly after (afterDateKey,
 * afterPeriodNumber), whose subject matches subjectId — what "Move to
 * next Science period" resolves to, so a teacher never has to search
 * for it manually. Scans forward day by day, bounded by
 * `horizonDays` (default 60 — generously beyond a single term) so a
 * classroom with no future occurrence of this subject configured
 * returns null rather than scanning forever.
 */
export function getNextFutureSlotForSubject(classroom, { subjectId, afterDateKey, afterPeriodNumber, horizonDays = 60 }) {
  const periods = getPeriods(classroom);

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const dateKey = shiftDateKey(afterDateKey, offset);
    const weekday = weekdayOfDateKey(dateKey);

    for (const period of periods) {
      if (offset === 0 && period.periodNumber <= afterPeriodNumber) continue;

      const slot = getSlot(classroom, weekday, period.periodNumber);
      if (!slot || slot.subjectId !== subjectId) continue;

      return createTeachingSlot({
        id: buildTeachingSlotId(classroom.id, dateKey, period.periodNumber),
        date: dateKey,
        weekday,
        periodNumber: period.periodNumber,
        duration: minutesBetween(period.startTime, period.endTime),
        subjectId: slot.subjectId,
      });
    }
  }

  return null;
}

/**
 * The next `limit` future TeachingSlots for this subject, strictly
 * after (afterDateKey, afterPeriodNumber) — feeds the reference's
 * "Other Science periods" secondary list on the Carry Forward screen.
 * IMPORTANT: pass the PRIMARY suggestion's own {date, periodNumber}
 * (from getNextFutureSlotForSubject()) as afterDateKey/afterPeriodNumber
 * here, not the original source slot's — otherwise the primary
 * suggestion would duplicate as this list's own first entry. `limit`
 * caps how many alternatives are computed/returned (the reference
 * shows 2).
 */
export function getOtherFutureSlotsForSubject(classroom, { subjectId, afterDateKey, afterPeriodNumber, horizonDays = 60, limit = 2 }) {
  const results = [];
  let cursorDateKey = afterDateKey;
  let cursorPeriodNumber = afterPeriodNumber;

  while (results.length < limit) {
    const next = getNextFutureSlotForSubject(classroom, {
      subjectId,
      afterDateKey: cursorDateKey,
      afterPeriodNumber: cursorPeriodNumber,
      horizonDays,
    });
    if (!next) break;
    results.push(next);
    cursorDateKey = next.date;
    cursorPeriodNumber = next.periodNumber;
  }

  return results;
}

/**
 * Suggests where a concept could be carried to: the very next future
 * same-subject Teaching Slot as the PRIMARY suggestion (what "Move to
 * next Science period" resolves to), plus up to `otherLimit` further
 * alternatives — the reference's "Other Science periods" secondary
 * list. Read-only; moves nothing (see services/carryForwardService.js
 * for the actual move). Lives here, not in carryForwardService.js,
 * specifically so it stays unit-testable without pulling in
 * services/plannerRepository.js's real Firestore import.
 */
export function suggestCarryForwardTargets(classroom, { subjectId, afterDateKey, afterPeriodNumber, otherLimit = 2 }) {
  const primary = getNextFutureSlotForSubject(classroom, { subjectId, afterDateKey, afterPeriodNumber });
  if (!primary) return { primary: null, others: [] };

  const others = getOtherFutureSlotsForSubject(classroom, {
    subjectId,
    afterDateKey: primary.date,
    afterPeriodNumber: primary.periodNumber,
    limit: otherLimit,
  });

  return { primary, others };
}
