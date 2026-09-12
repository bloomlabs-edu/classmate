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
import { getSubjects } from './learningRecordService.js';

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

/** The classroom's own Learning Record title for an event's subjectId, matching services/timetableDisplayService.js's own resolveSubjectTitle() convention — kept as a thin, separate helper here (rather than importing that file directly) so this file's own dependency surface stays limited to what it actually needs. Returns '' for an event with no subjectId at all (a future non-subject event type, e.g. an Assembly). */
export function resolveEventSubjectTitle(classroom, event) {
  if (!event.subjectId) return '';
  const learningSubject = getSubjects(classroom).find((subject) => subject.subjectId === event.subjectId);
  return learningSubject?.title || event.subjectId;
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
