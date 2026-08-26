/**
 * services/conceptRecordMerge.js
 *
 * The pure, dependency-free half of the Phase N hydration step (see
 * services/conceptRecordHydrationService.js for the async Firestore-
 * touching orchestration around this). Deliberately its own file with
 * no Firestore import at all — every other pure model/service file in
 * this app (models/Lesson.js's carryForwardConcept(), etc.) follows the
 * same split so its logic can be unit-tested directly under `node
 * --test`, which cannot resolve the gstatic Firestore SDK's own
 * https:// import specifiers.
 *
 * Overlays real classrooms/{id}/studentConceptRecords documents onto
 * the existing in-memory Student.learningRecord map shape — the one
 * and only reason every existing consumer
 * (learningRecordService.getStudentConceptRecord(), ConceptWorkspaceView.js,
 * StudentLearningView.js, conceptFeedbackService.js, ...) keeps working
 * completely unchanged after the storage migration: as long as this
 * runs before any of them read a classroom/student, they see the same
 * shape they always have.
 */

import { findStudentInClassroom } from './studentService.js';

/**
 * Mutates `classroom` in place: for each fetched
 * studentConceptRecords document, finds its owning student and sets
 * `student.learningRecord[conceptId]` to the record's own domain shape
 * — overwriting whatever was there before, since a record actually
 * fetched from the new collection is always more current than
 * whatever the legacy embedded field happened to hold (see
 * services/conceptRecordHydrationService.js's own header comment on
 * the fallback order this implements across the two calls together).
 *
 * A record whose studentId no longer matches any real roster student
 * (e.g. a removed student) is silently skipped — the same "degrade
 * quietly, never throw" convention getStudentConceptRecord() itself
 * already follows for a missing entry.
 *
 * Returns the same `classroom` reference, for convenient chaining at
 * call sites that want to keep using the result inline.
 */
export function mergeConceptRecordsIntoClassroom(classroom, records) {
  records.forEach((record) => {
    const found = findStudentInClassroom(classroom, record.studentId);
    if (!found) return;

    if (!found.student.learningRecord) found.student.learningRecord = {};
    found.student.learningRecord[record.conceptId] = {
      understanding: record.understanding,
      notebook: record.notebook,
      helpRequested: record.helpRequested,
      updatedAt: record.updatedAt,
    };
  });

  return classroom;
}
