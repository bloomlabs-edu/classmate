/**
 * models/LearningConcept.js
 *
 * The leaf of the Learning Record syllabus tree: Subject -> Unit ->
 * Concept (see models/LearningSubject.js, models/LearningUnit.js).
 * Deliberately named "LearningConcept" rather than "Concept" — this
 * module intentionally has no shared vocabulary with Learning Hub or
 * anything else in this app (see docs/LEARNING_RECORD.md's
 * independence section).
 *
 * A Concept here holds only `status` — whether it's been taught to
 * the class yet (see config/learningRecordConfig.js's
 * CONCEPT_STATUS_KEYS). It deliberately does NOT hold
 * understanding/notebook/helpRequested — those vary per student, so
 * they live in each Student's own `learningRecord` map, keyed by this
 * concept's id (see models/StudentConceptRecord.js and
 * models/Student.js). This is the same "shared entity created once,
 * then a separate per-student record for anything individual" split
 * this app already uses for Learning Activities
 * (models/LearningActivity.js + Student.submissions).
 */

import { generateId } from '../utils/idGenerator.js';

export function createLearningConcept({ id, title, status = 'not_taught' } = {}) {
  return {
    id: id || generateId(),
    title,
    status,
  };
}
