/**
 * services/scheduledEventService.js
 *
 * Pure logic over already-fetched models/ScheduledEvent.js records —
 * deliberately Firestore-free (no import of
 * services/scheduledEventRepository.js here), the same "stays directly
 * unit-testable" convention services/timetableDisplayService.js's own
 * header comment already documents for the identical reason. A caller
 * that needs both pure logic and the real Firestore read imports both
 * itself (see ui/views/TimetableView.js, ui/components/
 * TodaysScheduleWidget.js) — two small steps, never one opaque
 * Firestore-touching convenience function.
 */

import { createScheduledEvent, SCHEDULED_EVENT_TYPES } from '../models/ScheduledEvent.js';
import { resolveSubjectTitle } from './timetableDisplayService.js';

/** Every event in `events` whose own `date` matches `dateKey` exactly, ordered by start time — what services/schoolCalendarService.js's own getEffectiveScheduleForDate() is handed as its own `eventsForDate` argument. */
export function getEventsForDate(events, dateKey) {
  return events
    .filter((event) => event.date === dateKey)
    .sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
}

/** Every event of exactly one type (e.g. 'exam') — a plain filter, kept here so a future second event type never needs its own bespoke filter function invented ad hoc at a call site. */
export function getEventsByType(events, eventType) {
  return events.filter((event) => event.eventType === eventType);
}

/**
 * An event's own display subject title. Three cases, checked in order:
 *
 * 1. `event.customSubjectName` set (a free-typed subject not on the
 *    canonical list, see models/ScheduledEvent.js's own header
 *    comment) — returned directly, no further fallback. This always
 *    wins outright: a free-typed title is exactly what should display,
 *    regardless of whatever `subjectId` was derived from it.
 * 2. `event.subjectId` set, no `customSubjectName` — delegates to
 *    services/timetableDisplayService.js's own resolveSubjectTitle(),
 *    the SAME three-tier fallback (classroom's own Learning-configured
 *    title -> canonical registry title -> raw id) every other
 *    Timetable subject display already uses. Deliberately delegated
 *    rather than re-implemented here a second time — two independent
 *    copies of the identical fallback chain drift out of sync exactly
 *    the way an earlier version of this function already had (it was
 *    missing the canonical-registry middle tier entirely). Importing
 *    timetableDisplayService.js here is safe: that file is itself
 *    Firestore-free/pure (see its own header comment) and imports only
 *    learningRecordService.js, subjectIdentityService.js and
 *    dateHelpers.js — none of which import this file — so there is no
 *    import cycle.
 * 3. Neither set (a future non-subject event type, e.g. an Assembly) —
 *    `''`, never a thrown error.
 */
export function resolveEventSubjectTitle(classroom, event) {
  if (event.customSubjectName) return event.customSubjectName;
  if (!event.subjectId) return '';
  return resolveSubjectTitle(classroom, event.subjectId);
}

/** A short, human display label for an event type — 'Exam' for 'exam', title-cased fallback for anything future (e.g. 'school_event' -> 'School Event') so a not-yet-specially-labeled future type still reads sensibly rather than showing a raw enum value. */
export function getEventTypeLabel(eventType) {
  if (eventType === SCHEDULED_EVENT_TYPES.EXAM) return 'Exam';
  return eventType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The exact field set a "Duplicate" action (ui/views/TimetableView.js's
 * own Exams & Events list) copies from a source event into a brand-new
 * one — deliberately everything EXCEPT `id`/`classroomId`/
 * `createdAt`/`updatedAt`/`eventType`, so the caller can hand this
 * straight to models/ScheduledEvent.js's own createScheduledEvent()
 * (which generates a fresh id and timestamps) to get a genuinely
 * independent record, never a reference back to `sourceEvent`. There is
 * deliberately no `batchId`/`duplicatedFrom`/similar field anywhere in
 * this return value or in models/ScheduledEvent.js itself — per this
 * feature's own explicit "no hidden linkage between exams" requirement,
 * editing or deleting either the source or the duplicate must never
 * affect the other one.
 *
 * Extracted as its own pure, DOM-free function (rather than inlined at
 * the "Duplicate" button's click handler) specifically so this exact
 * copy behavior — which fields travel, which don't — stays unit-
 * testable without a DOM, the same reasoning this file's own header
 * comment already gives for keeping this module Firestore-free.
 */
export function buildDuplicateExamFields(sourceEvent) {
  return {
    date: sourceEvent.date,
    startTime: sourceEvent.startTime,
    endTime: sourceEvent.endTime,
    title: sourceEvent.title,
    subjectId: sourceEvent.subjectId,
    customSubjectName: sourceEvent.customSubjectName,
    gradeLabel: sourceEvent.gradeLabel,
    room: sourceEvent.room,
    invigilatorUid: sourceEvent.invigilatorUid,
  };
}

/** (date, startTime) ascending — the same ordering getEventsForDate() already sorts by, factored out so groupEventsByTitle() below sorts both members and groups with the identical comparison rather than a second copy. */
function compareEventsByDateTime(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.startTime === b.startTime) return 0;
  return a.startTime < b.startTime ? -1 : 1;
}

/**
 * Groups a flat list of ScheduledEvents by their own `title` — for
 * display contexts (ui/views/TimetableView.js's School Calendar "Exams
 * & Events" list) where several events genuinely share one exam name
 * (e.g. five subjects all under "Quarterly Examinations") and repeating
 * that name as prominent content on every individual tile is noise;
 * the caller instead shows the shared title once as a group heading,
 * with per-event tiles underneath differentiated by subject and
 * date/time.
 *
 * Returns `[{ title, events }]`:
 * - Grouped by exact `title` string match — deliberately simple/strict.
 *   Fuzzy-merging user-typed titles (trimming, case-folding, etc.) risks
 *   silently conflating two genuinely different exams that merely typed
 *   their name a little differently; that's judged the worse failure
 *   mode, so it's not done here.
 * - A title held by only one event still gets its own one-member group
 *   — there is no special-casing that drops or reshapes singleton
 *   groups; every event ends up in exactly one group either way.
 * - Groups are ordered by their earliest member's (date, startTime);
 *   members within a group are ordered the same way.
 * - Never mutates `events` or any individual event, and never
 *   duplicates an event — each group's `events` array holds the exact
 *   same object references handed in, just partitioned and sorted.
 */
export function groupEventsByTitle(events) {
  const groupsByTitle = new Map();
  events.forEach((event) => {
    const key = event.title || '';
    if (!groupsByTitle.has(key)) groupsByTitle.set(key, { title: key, events: [] });
    groupsByTitle.get(key).events.push(event);
  });

  const groups = [...groupsByTitle.values()];
  groups.forEach((group) => group.events.sort(compareEventsByDateTime));
  groups.sort((a, b) => compareEventsByDateTime(a.events[0], b.events[0]));
  return groups;
}

export { createScheduledEvent, SCHEDULED_EVENT_TYPES };
