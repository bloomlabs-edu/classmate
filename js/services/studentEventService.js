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
 *
 * STAGE 1 ADDITION (notification architecture audit, Section E) — this
 * file now also owns the student-facing notification BELL's own read
 * state: classrooms/{classroomId}/studentEventReadState/{studentUid}
 * (see repositories/firestoreStudentEventReadStateRepository.js's own
 * header comment for why that's a separate collection rather than a
 * field on the event/classroom itself). Event CONTENT below is
 * completely unchanged — publishEvent()/getEventsForStudent() do
 * exactly what they always did; nothing about "Your Updates" is
 * touched by any of this. This is purely additive: which of a
 * student's own already-existing events they've personally seen.
 */

import { createStudentEvent } from '../models/StudentEvent.js';
import * as studentDeviceService from './studentDeviceService.js';
import * as studentAuthService from './studentAuthService.js';
import * as readStateRepository from '../repositories/firestoreStudentEventReadStateRepository.js';

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

/**
 * A student Event's own `title`/`message` are always written
 * second-person at creation time (see classModeService.js's
 * awardStar(), StudentProfileView.js's own "+ Award Badge" handlers,
 * assessmentService.js's publishAssessment()) — correct, since an
 * event exists to be read by the student it happened to, in their own
 * Journey/notifications. That stored text is never rewritten and
 * never duplicated into a second model; this function is the one,
 * shared place that decides how to PRESENT an event differently
 * depending on who's currently looking at it, without the event
 * itself ever needing two versions of anything.
 *
 * Three viewer contexts, not two — confirmed as genuinely distinct
 * by direct trace of ui/student-portal/views/StudentPublicProfileView.js:
 * that screen renders THE SAME event cards as a student's own Journey
 * (both go through this file's own renderEventCard()), but the
 * viewer there is looking at a CLASSMATE's public profile, not their
 * own — "you earned a star" is only ever true for the student the
 * event actually happened to, never for whoever happens to be
 * looking at their profile.
 *
 *   - 'self'    — the student the event happened to, viewing their
 *                 own Journey. Returns the event's own stored
 *                 title/message, completely unchanged. The only
 *                 context where second-person is correct.
 *   - 'teacher' — a teacher viewing a student's profile. Neutral,
 *                 computed fresh from event.type/event.payload —
 *                 never read from the event's own title/message.
 *   - 'peer'    — a different student viewing someone else's public
 *                 profile. Also neutral, computed the same way as
 *                 'teacher', but phrased slightly differently where
 *                 it matters (a classmate has no reason to be told
 *                 who awarded something — "awarded by the teacher"
 *                 is teacher-relative context a peer doesn't need).
 *
 * Unrecognized event types fall back to the event's own stored title
 * unchanged, rather than throwing — a screen showing
 * slightly-imperfect copy for a type this function doesn't know about
 * yet is a far smaller problem than that screen crashing outright.
 */
const NEUTRAL_EVENT_COPY = {
  teacher: {
    star_awarded: () => ({ title: '\u2b50 Earned a star', message: 'Awarded by the teacher for effort in class.' }),
    badge_awarded: (event) => ({
      title: `\ud83c\udf96\ufe0f Earned the \u201c${event.payload?.badgeName ?? 'badge'}\u201d badge`,
      message: 'Recognized by the teacher for this.',
    }),
    assessment_published: (event) => ({ title: event.title, message: 'Results are now available.' }),
  },
  peer: {
    star_awarded: () => ({ title: '\u2b50 Earned a star', message: 'Awarded for effort in class.' }),
    badge_awarded: (event) => ({
      title: `\ud83c\udf96\ufe0f Earned the \u201c${event.payload?.badgeName ?? 'badge'}\u201d badge`,
      message: 'Recognized for this.',
    }),
    assessment_published: (event) => ({ title: event.title, message: 'Results are now available.' }),
  },
};

export function getEventCopyForViewer(event, viewer = 'self') {
  if (viewer !== 'teacher' && viewer !== 'peer') return { title: event.title, message: event.message };

  const buildNeutralCopy = NEUTRAL_EVENT_COPY[viewer][event.type];
  return buildNeutralCopy ? buildNeutralCopy(event) : { title: event.title, message: event.message };
}

// --- Stage 1: notification bell read state ---

/** Pure — how many of these events aren't in readEventIds yet. Takes plain data (never touches Firestore itself), matching this file's own existing style for everything above. */
export function countUnread(events, readEventIds) {
  const readSet = new Set(readEventIds || []);
  return events.filter((event) => !readSet.has(event.id)).length;
}

/**
 * Resolves the currently-active student profile's own per-slot
 * Firestore instance + real (if anonymous) uid — the same
 * classroomId/slotIndex/uid resolution
 * services/feedService.js's createPostAsCurrentStudent() and
 * services/studentGoalsService.js's submitGoalForCurrentStudent()
 * already each do independently; kept local to this file rather than
 * extracted, matching how those two files also don't share it today.
 */
async function resolveActiveStudentContext() {
  const activeProfile = studentDeviceService.getActiveProfile();
  if (!activeProfile) return null;

  const slotIndex = studentDeviceService.getSlotForStudent(activeProfile.studentId);
  if (slotIndex === null) return null;

  const db = studentAuthService.getFirestoreForSlot(slotIndex);
  const uid = await studentAuthService.ensureAnonymousSignIn(slotIndex);
  return { classroomId: activeProfile.classroomId, db, uid };
}

/** Marks one event read for the current student — writes through their own per-slot Firestore instance, matching submitGoalForCurrentStudent()'s own established convention exactly. Returns true on success; false (never throws) if there's no active profile or the write was rejected. */
export async function markEventReadForCurrentStudent(eventId) {
  const context = await resolveActiveStudentContext();
  if (!context) return false;

  try {
    await readStateRepository.markEventRead(context.db, context.classroomId, context.uid, eventId);
    return true;
  } catch (error) {
    console.error('[studentEventService] markEventReadForCurrentStudent() failed:', error);
    return false;
  }
}

/** Marks several events read in one write — the bell's own "dwell in the open popover" behavior calls this instead of N individual markEventReadForCurrentStudent() calls. */
export async function markEventsReadForCurrentStudent(eventIds) {
  if (!eventIds || eventIds.length === 0) return true;

  const context = await resolveActiveStudentContext();
  if (!context) return false;

  try {
    await readStateRepository.markEventsRead(context.db, context.classroomId, context.uid, eventIds);
    return true;
  } catch (error) {
    console.error('[studentEventService] markEventsReadForCurrentStudent() failed:', error);
    return false;
  }
}

/**
 * Live-subscribes to the current student's own read state. Resolving
 * the active profile's own uid is async (ensureAnonymousSignIn), but
 * every other subscription in this app returns its own unsubscribe
 * function synchronously — this does too, via a small guard: if
 * unsubscribe() is called before the async resolution above finishes,
 * `cancelled` stops the subscription from ever starting at all, rather
 * than leaking a listener nothing can reach anymore.
 */
export function subscribeToReadStateForCurrentStudent(onChange, onError) {
  let unsubscribe = null;
  let cancelled = false;

  resolveActiveStudentContext()
    .then((context) => {
      if (!context || cancelled) return;
      unsubscribe = readStateRepository.subscribeToReadState(context.db, context.classroomId, context.uid, onChange, onError);
    })
    .catch((error) => onError?.(error));

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
