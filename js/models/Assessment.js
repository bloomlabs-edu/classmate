/**
 * models/Assessment.js
 *
 * Assessment Management's own top-level record — a school-administration
 * artifact (Mid Term Examination, Unit Test 1, ...), deliberately
 * independent of Learning Management. Nothing in this file, or
 * anything it owns (see models/AssessmentSubject.js,
 * models/StudentResult.js), references a Concept, a Unit, a
 * curriculum link, or a Resource. The only connection to Learning
 * Management at all is each AssessmentSubject's own `subjectId`
 * reference — see that model's own header comment for why it's a
 * reference and not a copy.
 *
 * Owns its AssessmentSubjects directly, the same "owns its children as
 * a plain array" pattern already used throughout this app (see
 * models/Team.js, models/LearningSubject.js).
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createAssessment({
  id,
  classroomId,
  title,
  type,
  academicYear = '',
  date = '',
  createdAt,
  assessmentSubjects = [],
} = {}) {
  return {
    id: id || generateId(),
    classroomId,
    title,
    type,
    academicYear,
    date,
    createdAt: createdAt || getCurrentIsoDate(),
    assessmentSubjects,
  };
}
