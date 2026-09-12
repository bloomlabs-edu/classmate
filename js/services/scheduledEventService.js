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

export { createScheduledEvent, SCHEDULED_EVENT_TYPES };
