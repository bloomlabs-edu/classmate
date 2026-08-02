/**
 * services/studentEventService.js
 *
 * Owns `classroom.studentEvents` — the flat, append-only array behind
 * every student's own event feed (see models/StudentEvent.js). Every
 * feature that wants to notify a student calls publishEvent() once its
 * own action has actually succeeded; the Student Portal reads back
 * through getEventsForStudent() (via services/studentPortalDataService.js,
 * this app's own single Student Portal data-access rule — nothing in
 * ui/student-portal/ should ever import this file directly).
 */

import { createStudentEvent } from '../models/StudentEvent.js';

/**
 * Publishes one event for one student. Call this only after the
 * triggering action has actually completed successfully (e.g. a badge
 * genuinely newly awarded, not a duplicate-award no-op) — this
 * function itself doesn't check for that, since what counts as
 * "succeeded" is specific to each publisher.
 */
export function publishEvent(classroom, { studentId, type, category, title, message, payload }) {
  if (!classroom.studentEvents) classroom.studentEvents = [];
  const event = createStudentEvent({
    studentId,
    classroomId: classroom.id,
    type,
    category,
    title,
    message,
    payload,
  });
  classroom.studentEvents.push(event);
  return event;
}

/**
 * Publishes the same event to every student currently on this
 * classroom's roster — for events that aren't about one specific
 * student (e.g. an Assessment being published applies to the whole
 * class, not whoever happens to already have a StudentResult entry).
 */
export function publishEventToAllStudents(classroom, eventDetails) {
  const students = classroom.teams.flatMap((team) => team.students);
  return students.map((student) => publishEvent(classroom, { ...eventDetails, studentId: student.id }));
}

/** This student's own event feed, newest first — sorting happens here, at read time, matching this app's own established convention (see services/assessmentService.js's listAssessments()) rather than requiring insertion order to already be correct. */
export function getEventsForStudent(classroom, studentId) {
  return (classroom.studentEvents || [])
    .filter((event) => event.studentId === studentId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
