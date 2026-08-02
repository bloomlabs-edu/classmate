/**
 * models/StudentEvent.js
 *
 * One entry in a student's own event feed — the foundation of the
 * Student Home screen's "Your Updates" timeline (see
 * ui/student-portal/views/StudentJourneyView.js). Deliberately
 * generic: every publisher (Recognition today; Learning Hub,
 * attendance, assignments, teacher notes, announcements later)
 * produces the exact same shape, so the timeline itself never needs
 * per-type rendering logic and a new publisher never requires a UI
 * change — only a new `category`/`type` value and its own
 * title/message text.
 *
 * `type` — a specific, stable identifier for what happened (e.g.
 * 'badge_awarded', 'star_awarded', 'assessment_published') — used for
 * analytics/debugging and as a natural key if a future feature needs
 * to distinguish event kinds programmatically. Never shown to the
 * student directly; `title`/`message` are what the student reads.
 *
 * `category` — one of the six tags this milestone establishes
 * (Recognition, Assessment, Learning, Classroom, Team, Announcement —
 * see config/studentEventCategories.js) — shown directly on every
 * card as its tag, per explicit design: a single continuous timeline
 * with tags, not grouped sections.
 *
 * `payload` — a plain object carrying whatever structured data this
 * event's own type needs beyond title/message (e.g. `{ badgeName }`
 * for a badge award, `{ assessmentId }` for a published assessment).
 * Never read generically by the timeline UI itself — only a future,
 * type-aware feature (e.g. "tap to open the published assessment")
 * would ever reach into it, and only for its own known type.
 *
 * `readAt` — optional, null until read. Stored as part of the model
 * from this milestone on since the shape should be right from the
 * start, but no "mark as read" UI exists yet — out of scope for this
 * milestone, per explicit instruction to introduce the event system
 * without expanding beyond publishing and displaying it.
 *
 * Stored as a flat array directly on the classroom object
 * (`classroom.studentEvents`), each entry carrying its own
 * `studentId` — the same "flat array + reference field, not nested
 * per student" pattern already used for StudentResult (see
 * models/StudentResult.js) and every other per-student record in this
 * app. Sorting newest-first happens at read time (see
 * services/studentEventService.js's getEventsForStudent()), matching
 * this app's own established convention (see
 * services/assessmentService.js's listAssessments()) rather than
 * requiring insertion order to be correct.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createStudentEvent({
  id,
  studentId,
  classroomId,
  type,
  category,
  title,
  message,
  payload = {},
  createdAt,
  readAt = null,
} = {}) {
  return {
    id: id || generateId(),
    studentId,
    classroomId,
    type,
    category,
    title,
    message,
    payload,
    createdAt: createdAt || getCurrentIsoDate(),
    readAt,
  };
}
