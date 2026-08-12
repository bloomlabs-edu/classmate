/**
 * services/learningRecordService.js
 *
 * The shared, read-only layer for Learning Record — every query
 * either learningRecordTeacherService.js, learningRecordStudentService.js,
 * or a future UI needs, in one place, so there's exactly one way to
 * walk the Subject -> Unit -> Concept tree and exactly one place that
 * knows the per-student default (a concept with no entry in a
 * student's `learningRecord` map is 'not_marked' / 'not_required' /
 * not requesting help, not undefined — see
 * getStudentConceptRecord()).
 *
 * Read-only guarantee: nothing in this file ever mutates the
 * classroom or a student, or calls workspaceService.save(). Matches
 * the same hard invariant services/studentProgressService.js documents
 * for itself (see docs/PROGRESS_ENGINE.md) — anything that only reads
 * Learning Record data belongs here, not duplicated into the teacher
 * or student service.
 *
 * See docs/LEARNING_RECORD.md for the full architecture.
 */

import { createStudentConceptRecord } from '../models/StudentConceptRecord.js';

/** Every subject in this classroom's syllabus, in display order. */
export function getSubjects(classroom) {
  return classroom.learningRecord?.subjects || [];
}

export function getSubjectById(classroom, subjectId) {
  return getSubjects(classroom).find((subject) => subject.id === subjectId) || null;
}

export function getUnitById(classroom, unitId) {
  for (const subject of getSubjects(classroom)) {
    const unit = subject.units.find((u) => u.id === unitId);
    if (unit) return unit;
  }
  return null;
}

/** A concept plus the subject/unit it belongs to — most callers that have just a conceptId need this, not the bare concept. */
export function findConcept(classroom, conceptId) {
  for (const subject of getSubjects(classroom)) {
    for (const unit of subject.units) {
      const concept = unit.concepts.find((c) => c.id === conceptId);
      if (concept) return { subject, unit, concept };
    }
  }
  return null;
}

export function getConceptById(classroom, conceptId) {
  return findConcept(classroom, conceptId)?.concept || null;
}

/** Every concept in the classroom's syllabus, flattened, each annotated with its subject/unit for display. */
export function getAllConcepts(classroom) {
  const concepts = [];
  getSubjects(classroom).forEach((subject) => {
    subject.units.forEach((unit) => {
      unit.concepts.forEach((concept) => {
        concepts.push({ subject, unit, concept });
      });
    });
  });
  return concepts;
}

/**
 * A given student's record for one concept — always returns a real
 * record, never undefined/null, even if this student has never
 * touched this concept. A concept with no entry yet is exactly
 * equivalent to a freshly-created default record (see
 * models/StudentConceptRecord.js), the same "missing entry has a
 * defined default" contract services/learningActivityService.js's
 * getSubmissionStatus() already uses for `submissions`.
 */
export function getStudentConceptRecord(student, conceptId) {
  return student.learningRecord?.[conceptId] || createStudentConceptRecord();
}

/** Every concept the class has been taught, for progress displays ("32 of 48 concepts taught"). */
export function getTaughtConcepts(classroom) {
  return getAllConcepts(classroom).filter(({ concept }) => concept.status === 'taught');
}

/**
 * Rollup of one student's understanding across every taught concept —
 * untaught concepts are excluded, since a student can't meaningfully
 * self-report understanding of something they haven't been taught yet.
 * Returns counts per config/learningRecordConfig.js's UNDERSTANDING_KEYS.
 */
export function getStudentUnderstandingSummary(classroom, student) {
  const summary = { not_marked: 0, understand: 0, can_teach: 0, need_help: 0, confident: 0 };
  getTaughtConcepts(classroom).forEach(({ concept }) => {
    const record = getStudentConceptRecord(student, concept.id);
    summary[record.understanding] = (summary[record.understanding] || 0) + 1;
  });
  return summary;
}

/**
 * Every (student, concept) pair currently flagged helpRequested, across
 * the whole roster — the query a future "who needs help right now"
 * teacher view would run. Deliberately takes the full student list
 * rather than a single student, since help requests are inherently a
 * whole-classroom concern for the teacher (unlike understanding, which
 * is read one student at a time).
 */
export function getOpenHelpRequests(classroom) {
  const requests = [];
  classroom.teams.forEach((team) => {
    team.students.forEach((student) => {
      Object.entries(student.learningRecord || {}).forEach(([conceptId, record]) => {
        if (record.helpRequested) {
          const found = findConcept(classroom, conceptId);
          if (found) {
            requests.push({ student, team, subject: found.subject, unit: found.unit, concept: found.concept });
          }
        }
      });
    });
  });
  return requests;
}
