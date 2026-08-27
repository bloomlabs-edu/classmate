/**
 * models/TeachingSlot.js
 *
 * A single, concrete "a class happens here" occurrence — one specific
 * date, one period, one subject. Deliberately temporary, per explicit
 * product decision: a permanent Timetable module doesn't exist yet in
 * Classroom Management, and Planner shouldn't be blocked waiting for
 * it. Wherever the list of these eventually comes from — an uploaded
 * timetable, a future Classroom Timetable module, or manual entry —
 * services/plannerEngine.js only ever sees this same plain shape and
 * never knows or cares which source produced it.
 *
 * Already expanded into concrete dates by whatever supplies it — this
 * is not a recurring pattern to be expanded (there's no weekly-repeat
 * math here, unlike the date-expansion a real Timetable would need).
 * That's a deliberate simplification: producing the concrete list is
 * the caller's job; scheduling curriculum content onto an
 * already-concrete list is the Planner's.
 *
 * `id` isn't part of the shape you described, but every other entity
 * in this app self-generates one (Student, Team, Event, ...), and
 * Lesson needs a stable way to say "this lesson came from that slot"
 * (see models/Lesson.js's own `teachingSlotId`) — so this follows the
 * same convention rather than inventing a different way to reference
 * it.
 */

import { generateId } from '../utils/idGenerator.js';

export function createTeachingSlot({ id, date, weekday, periodNumber, duration, subjectId, teacherUid = null } = {}) {
  return {
    id: id || generateId(),
    date, // ISO date string, e.g. "2026-10-14"
    weekday, // 0 (Sun) - 6 (Sat) — carried alongside `date` for display convenience, not relied on for scheduling logic (date is authoritative)
    periodNumber,
    duration, // minutes; becomes a Lesson's own estimatedMinutes at generation time
    subjectId, // the canonical subjectId (see services/subjectIdentityService.js) this slot is taught in
    // Carried straight through from the recurring models/Timetable.js
    // slot this concrete occurrence was derived from (see
    // services/timetableService.js's getConcreteSlotsForDateRange()) —
    // null when that recurring slot has no "Taught by" assignment yet.
    // Powers services/personalHubService.js's own Today/My Week
    // filtering; unrelated to Planner/Lesson generation, which never
    // reads this field.
    teacherUid,
  };
}
