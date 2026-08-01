/**
 * models/Student.js
 *
 * Describes the shape of a Student record — the central entity of the
 * app. Students live nested inside their Team's `students` array (see
 * models/Team.js).
 *
 * Fields:
 *   rollNumber  - a student's register/roll number, null until set.
 *                 Currently only read, not written, anywhere in the
 *                 UI — services/assessmentService.js's sorting reads
 *                 it (Assessment Management's "Sort by: Roll Number"),
 *                 but no screen yet lets a teacher actually set one; a
 *                 natural follow-up in roster management, not built
 *                 here since it's outside Assessment Management's own
 *                 scope.
 *   score       - current session score, adjusted by timeline entries
 *                 (see services/timelineService.js)
 *   bucket      - one of config/bucketConfig.js's BUCKET_KEYS ('green' /
 *                 'yellow' / 'red') or null, displayed as "Not Assigned"
 *                 when null. Always optional, including on import.
 *   badges      - names of Behaviour Badges currently awarded (see
 *                 services/badgeService.js); drawn from the classroom's
 *                 badge catalog
 *   notes       - Note[] (see models/Note.js) — a chronological log of
 *                 short dated notes, not one long free-text field
 *   submissions - { [learningActivityId]: { status, feedback, score,
 *                 updatedAt } } — this student's status against each of
 *                 the classroom's Learning Activities (see
 *                 models/LearningActivity.js and
 *                 services/learningActivityService.js). An activity with
 *                 no entry here is "Not Assigned" for this student.
 *   learningRecord - { [conceptId]: StudentConceptRecord } — this
 *                 student's own understanding/notebook/helpRequested
 *                 against each concept in the classroom's Learning
 *                 Record syllabus (see models/LearningSubject.js,
 *                 models/StudentConceptRecord.js, and
 *                 services/learningRecordService.js). Same "shared
 *                 entity + a per-student map keyed by its id" shape as
 *                 `submissions` above, for the same reason. A concept
 *                 with no entry here is 'not_marked' /
 *                 'not_required' / not requesting help for this
 *                 student — see
 *                 learningRecordService.getStudentConceptRecord(),
 *                 which returns those defaults rather than undefined.
 *                 Completely independent of Learning Hub — see
 *                 docs/LEARNING_RECORD.md.
 *   history     - the Timeline: an array of { id, kind, label, delta,
 *                 recordedAt } entries (see services/timelineService.js).
 *                 This is the append-only log `score` is derived from,
 *                 matching the event-driven approach used elsewhere.
 */

import { generateId } from '../utils/idGenerator.js';

export function createStudent({
  id,
  name,
  rollNumber = null,
  score = 0,
  bucket = null,
  badges = [],
  notes = [],
  submissions = {},
  learningRecord = {},
  history = [],
} = {}) {
  return {
    id: id || generateId(),
    name,
    rollNumber,
    score,
    bucket,
    badges,
    notes,
    submissions,
    learningRecord,
    history,
  };
}
